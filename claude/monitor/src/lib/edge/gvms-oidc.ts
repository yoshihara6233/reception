/**
 * ログインの一本化（G・VMS の拠点がクラウドを OIDC の発行元にする・GVMS_CLOUD_SPEC §9）。
 *
 * 拠点は NVMS_OIDC_FROM_CLOUD=true のときだけ capabilities に `oidc` を名乗り、heartbeat で
 * 戻り先（oidc_redirect_uris）を申告する。ここではそれを受けて、拠点ごとに OAuth の
 * **公開クライアント**（秘密なし・PKCE 必須）を登録・更新・削除し、変わったら設定の版を
 * 上げて拠点へ配り直させる（配る中身は GET /api/edge/config が gvms_oidc_clients から作る）。
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const GVMS_CALLBACK_PATH = '/api/v1/auth/oidc/callback'
export const GVMS_ROLE_CLAIM = 'gvms_role'
const MAX_URIS = 10

/** 申告された戻り先を検査する。形の崩れたものは捨てる（heartbeat は落とさない）。 */
export function sanitizeRedirectUris(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out = new Set<string>()
  for (const v of raw) {
    if (typeof v !== 'string' || v.length > 300) continue
    let u: URL
    try { u = new URL(v) } catch { continue }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.search || u.hash) continue
    if (u.pathname !== GVMS_CALLBACK_PATH) continue
    out.add(`${u.protocol}//${u.host}${GVMS_CALLBACK_PATH}`)
    if (out.size >= MAX_URIS) break
  }
  return [...out].sort()
}

/** 発行元（Supabase Auth の OAuth 2.1 Server）。拠点は `${issuer}/.well-known/openid-configuration` を見る。 */
export function gvmsIssuer(): string {
  return `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')}/auth/v1`
}

/** 拠点へ配る oidc（クライアントが無ければ null）。 */
export async function oidcConfigFor(svc: SupabaseClient, edgeId: string) {
  const { data } = await svc.from('gvms_oidc_clients').select('client_id').eq('edge_id', edgeId).maybeSingle()
  if (!data?.client_id) return null
  return { issuer: gvmsIssuer(), client_id: data.client_id as string, role_claim: GVMS_ROLE_CLAIM }
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** 設定の版を上げる（拠点が配り直しを取りに来るように）。 */
async function bumpConfigVersion(svc: SupabaseClient, edgeId: string) {
  const { data: rec } = await svc.from('recorders').select('id, config_version')
    .eq('edge_id', edgeId).eq('vendor', 'nvms').order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (!rec) return
  await svc.from('recorders')
    .update({ config_version: (rec.config_version ?? 0) + 1, updated_at: new Date().toISOString() })
    .eq('id', rec.id)
}

export type OidcSyncResult = 'unchanged' | 'created' | 'updated' | 'deleted' | 'skipped' | 'error'

/**
 * heartbeat のたびに呼ぶ。名乗りと申告に合わせてクライアントを揃える。
 *
 * **失敗しても heartbeat は落とさない**（呼び出し側で結果を記録するだけ）。OAuth 2.1 Server が
 * 無効なプロジェクトでは登録が失敗するので、名乗っている拠点が無い限り Auth の API は呼ばない。
 */
export async function syncGvmsOidcClient(
  svc: SupabaseClient, edgeId: string, capabilities: string[] | null, rawUris: unknown,
): Promise<OidcSyncResult> {
  const wants = (capabilities ?? []).includes('oidc')
  const uris = wants ? sanitizeRedirectUris(rawUris) : []
  const { data: cur, error: readErr } = await svc.from('gvms_oidc_clients')
    .select('client_id, redirect_uris').eq('edge_id', edgeId).maybeSingle()
  if (readErr) return 'skipped'  // 表がまだ無い（migration の前）など

  try {
    if (uris.length === 0) {
      if (!cur) return 'unchanged'
      // 拠点が名乗りを外した → クライアントも消す（残すと、外した拠点へのトークンが出続ける）
      await svc.auth.admin.oauth.deleteClient(cur.client_id)
      await svc.from('gvms_oidc_clients').delete().eq('edge_id', edgeId)
      await bumpConfigVersion(svc, edgeId)
      return 'deleted'
    }
    if (!cur) {
      const { data, error } = await svc.auth.admin.oauth.createClient({
        client_name: `G・VMS ${edgeId}`,
        redirect_uris: uris,
        token_endpoint_auth_method: 'none',  // 公開クライアント（PKCE 必須）。拠点へ秘密を配らない
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'openid email profile',
      })
      if (error || !data) return 'error'
      await svc.from('gvms_oidc_clients').insert({ edge_id: edgeId, client_id: data.client_id, redirect_uris: uris })
      await bumpConfigVersion(svc, edgeId)
      return 'created'
    }
    if (sameList([...(cur.redirect_uris ?? [])].sort(), uris)) return 'unchanged'
    const { error } = await svc.auth.admin.oauth.updateClient(cur.client_id, { redirect_uris: uris })
    if (error) return 'error'
    await svc.from('gvms_oidc_clients')
      .update({ redirect_uris: uris, updated_at: new Date().toISOString() }).eq('edge_id', edgeId)
    return 'updated'  // client_id は変わらないので配り直しは要らない
  } catch {
    return 'error'
  }
}
