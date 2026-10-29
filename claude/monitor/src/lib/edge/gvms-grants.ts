/**
 * 拠点 (G・VMS) へのサインインの許可 (OAuth の同意・grant) の期限と一覧
 * (2026-10-30・自主診断 ASVS 10.4.9・10.7.2・GVMS_CLOUD_SPEC §9.5)。
 *
 * Supabase の OAuth 2.1 Server は、利用者が一度承認した拠点 (クライアント) を覚え、次からは
 * 同意の画面を出さずに戻す。その許可には**期限が無く**、利用者が取り消す画面も無かった。
 * ここで次の 2 つを足す:
 *   1. 許可の期限: 承認から GRANT_MAX_AGE_DAYS 日。過ぎた許可は、同意の画面とアカウントの画面を
 *      開いたときに本人の接続で取り消す (revokeGrant)。次のサインインで同意の画面がもう一度出る。
 *      Supabase には許可の期限の設定が無いため、アプリで行う。拠点へのサインインは必ず同意の画面
 *      (/oauth/consent) を通るので、そこで確かめれば漏れない。
 *   2. 一覧と取り消し: /account/sites が listGrants と revokeGrant を使う。取り消すと Supabase が
 *      その拠点向けのセッション (と refresh トークン) を消す。
 *
 * 期限の日数は案 (発注者の確認待ち・docs/authentication-policy.md §6)。
 */
import type { OAuthGrant, SupabaseClient } from '@supabase/supabase-js'

/** 許可の期限 (日)。案: 90 日 (発注者の確認待ち)。 */
export const GRANT_MAX_AGE_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

/** 許可の期限。granted_at が読めなければ null (期限切れとして扱う)。 */
export function grantExpiresAt(grantedAt: string | null | undefined): Date | null {
  const t = grantedAt ? Date.parse(grantedAt) : NaN
  if (!Number.isFinite(t)) return null
  return new Date(t + GRANT_MAX_AGE_DAYS * DAY_MS)
}

/** 期限が過ぎたか。日時の読めない許可も過ぎたものとして扱う (取り消して確かめ直す)。 */
export function grantExpired(grantedAt: string | null | undefined, now: Date = new Date()): boolean {
  const exp = grantExpiresAt(grantedAt)
  return exp === null || exp.getTime() <= now.getTime()
}

/** OAuth のクライアント ID の形 (Supabase は UUID)。 */
export function validClientId(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
}

type GrantApi = Pick<SupabaseClient['auth']['oauth'], 'listGrants' | 'revokeGrant'>

/**
 * 本人の許可を読み、期限の過ぎたものを取り消して、残りを返す。
 * 読めなければ null (OAuth 2.1 Server が無効なプロジェクトなど)。取り消しに失敗した許可は、
 * 期限切れのまま残さないよう一覧から外さずに返す (呼び出し側は expired で見分ける)。
 */
export async function activeGrants(
  oauth: GrantApi, now: Date = new Date(),
): Promise<{ grant: OAuthGrant; expired: boolean }[] | null> {
  const { data, error } = await oauth.listGrants()
  if (error || !data) return null
  const out: { grant: OAuthGrant; expired: boolean }[] = []
  for (const g of data) {
    if (!grantExpired(g.granted_at, now)) { out.push({ grant: g, expired: false }); continue }
    const { error: revokeErr } = await oauth.revokeGrant({ clientId: g.client.id })
    if (revokeErr) out.push({ grant: g, expired: true })
  }
  return out
}

export interface GrantSite {
  /** 登録した G・VMS の拠点のクライアントか */
  known: boolean
  edgeId: string | null
  storeId: string | null
  /** 画面に出すサインイン先 (店舗・機器の名前) */
  label: string
}

/** クライアント ID からサインイン先 (店舗と機器の名前) を引く。サービスの接続で読む。 */
export async function grantSites(svc: SupabaseClient, clientIds: string[]): Promise<Map<string, GrantSite>> {
  const out = new Map<string, GrantSite>()
  const ids = clientIds.filter(validClientId)
  if (ids.length === 0) return out
  const { data: clients } = await svc.from('gvms_oidc_clients').select('client_id, edge_id').in('client_id', ids)
  const edgeIds = (clients ?? []).map((c) => c.edge_id as string)
  const { data: edges } = edgeIds.length
    ? await svc.from('edge_devices').select('id, name, store_id, stores(name)').in('id', edgeIds)
    : { data: [] as never[] }
  const edgeById = new Map((edges ?? []).map((e) => [e.id as string, e]))
  for (const c of clients ?? []) {
    const e = edgeById.get(c.edge_id as string) as
      { name?: string | null; store_id?: string | null; stores?: { name?: string | null } | null } | undefined
    const label = [e?.stores?.name, e?.name].filter(Boolean).join('・') || '拠点'
    out.set(c.client_id as string, {
      known: true, edgeId: c.edge_id as string, storeId: e?.store_id ?? null, label,
    })
  }
  return out
}

/** 今の日時 (ISO)。画面の描画の中で Date を直に作らないための小さな部品。 */
export function nowIso(): string {
  return new Date().toISOString()
}

/** 日時を日本時間の「2026/10/30 09:00」の形にする。 */
export function formatJst(d: Date | string | null): string {
  if (!d) return '—'
  const t = typeof d === 'string' ? new Date(d) : d
  if (!Number.isFinite(t.getTime())) return '—'
  return t.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}
