/**
 * エッジ ブートストラップ（鍵ローテ無停止同期 / Phase A + スコープ鍵化 Phase B1）。
 *
 * エッジが `x-device-token` で認証し、現行の Supabase URL とスコープトークンを取得する。
 *
 * Phase B1（エッジ専用スコープ鍵化）: このエッジ専用の Supabase Auth ユーザで
 * signInWithPassword し、短命アクセストークン(≤1h)を `scoped_access_token` /
 * `scoped_expires_at` として追加で返す。エッジは edge_jobs だけをこのトークン
 * (authenticated/RLS スコープ)で叩く。トークンの app_metadata.edge_id を RLS が見て、
 * 自分宛の行だけに絞る。
 *
 * Phase B2: auth ユーザが未 provisioning なら **この場で作る**（旧実装は
 * scripts/provision-edge-auth.ts の手動実行が前提だった）。エンロールしたエッジが
 * 最初に bootstrap を叩いた時点でスコープ用の身元が揃うため、やり忘れが起きない。
 * SECRETS_ENC_KEY 未設定の環境では provisioning しない（平文保存を避ける）。
 *
 * 認証: 受け取ったトークンの SHA-256 が edge_devices.device_token_hash と
 *       一致する行のみ。平文は DB に無い（M-5 段階2）。
 *
 * **service_role は、どの拠点にも返さない (2026-11-13・Phase B4 の完了)。**
 *   以前は「試作のエッジ箱 (kind=edge)」には返していた。その登録コードは tenant_admin・
 *   store_manager でも発行できたため、テナントの管理者が enroll → bootstrap と呼ぶだけで
 *   service_role (全テナントの DB と置き場の読み書き) を受け取れた (2026-11-13 の見直しで発見。
 *   10/28 の直しは G・VMS (nvmsd) の拠点にしか効いていなかった)。
 *   本番のエッジ箱は 0 台。箱はスコープトークン (scoped_access_token) だけで動かす。
 *   スコープトークンを発行できなかった応答では、箱は次の pull (5 分後) まで DB に触れない
 *   (止まる側に倒す。鍵を返して動かし続ける側には倒さない)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseService } from '@/lib/supabase/server'
import { edgeAuthEmail, ensureEdgeAuthPassword } from '@/lib/edge/auth-provision'
import { hashDeviceToken } from '@/lib/edge/device-token'
import { storeTenantSuspended } from '@/lib/edge/device-auth'
import { edgeSecretKeysFor } from '@intereco/shared'

/**
 * 手持ちトークンの残り寿命がこれ以上あれば再発行しない（秒）。
 * bootstrap の pull 間隔（既定 5 分）より十分大きく取り、切れる前に必ず1回は回るようにする。
 */
const SCOPED_REISSUE_MARGIN_SEC = 15 * 60

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.headers.get('x-device-token')
  if (!token) return NextResponse.json({ error: 'missing device token' }, { status: 401 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return NextResponse.json({ error: 'server not configured' }, { status: 503 })

  // トークンをハッシュ化して引き当てる（monitor の env キーで RLS バイパス参照）。
  const supa = createSupabaseService()
  const { data, error } = await supa
    .from('edge_devices')
    .select('id, store_id, auth_user_id, auth_password_enc, desired_agent_version, desired_cloudflared_version')
    .eq('device_token_hash', hashDeviceToken(token))
    .maybeSingle()

  // ⚠ ここを 401 で一括りにしてはいけない。2026-08-06、migration 未適用で
  //   `scoped_only` 列が無い状態のデプロイが走り、PostgREST のスキーマエラーが
  //   「invalid device token」として返った。全エッジの bootstrap が同時に落ちたのに、
  //   ログ上はトークン不正と見分けがつかず切り分けに時間を要した。
  //   トークン不一致(401)とサーバ側の失敗(500)は必ず分けて返す。
  //
  //   ⚠ ただし **DB のメッセージをクライアントへ返さない**。分けたかったのは
  //     「トークン不正か、サーバ側の失敗か」であって、列名やスキーマ状態を
  //     教えることではない。切り分けは下の console.error（Vercel のログ）で足りる。
  if (error) {
    console.error('[bootstrap] edge_devices query failed', error.message)
    return NextResponse.json({ error: 'bootstrap lookup failed' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })
  // 停止したテナントの拠点には何も渡さない (2026-10-29・ASVS 7.4.2)
  if (await storeTenantSuspended(supa, data.store_id as string)) {
    return NextResponse.json({ error: 'tenant suspended' }, { status: 403 })
  }

  const body: {
    edge_id: string
    supabase_url: string
    scoped_access_token?: string
    scoped_expires_at?: number
    // 自律OTA: 本部が宣言する目標版（NULL=更新指示なし）。エッジは pull で受けて
    // shouldUpdateAgent 判断のうえ self-update する（docs/edge-ota-design.md）。
    desired_agent_version?: string | null
    desired_cloudflared_version?: string | null
    // このエッジの録画機の秘密を解く鍵 ({鍵の ID: base64})。マスタ鍵は渡さない (enc:v2・ASVS 13.3.2)
    secret_keys?: Record<string, string>
  } = {
    edge_id: data.id,
    supabase_url: url,
    desired_agent_version: (data.desired_agent_version as string | null) ?? null,
    desired_cloudflared_version: (data.desired_cloudflared_version as string | null) ?? null,
  }

  // 手持ちトークンがまだ十分に有効なら再サインインしない（5分毎の pull で毎回
  // signInWithPassword すると GoTrue のレート上限に近づくため）。ヘッダを送らない
  // 旧エージェントは従来どおり毎回発行される＝後方互換。
  const until = Number(req.headers.get('x-scoped-until') ?? '')
  const stillFresh = Number.isFinite(until) && until > Date.now() / 1000 + SCOPED_REISSUE_MARGIN_SEC

  // 短命スコープトークンを発行して同梱。auth ユーザが未 provisioning ならここで用意する。
  // 失敗しても 200 (スコープトークンを載せないだけ)。箱は次の pull でやり直す。
  if (!stillFresh && anon) {
    try {
      const password = await ensureEdgeAuthPassword(supa, {
        id: data.id,
        store_id: data.store_id as string,
        auth_user_id: data.auth_user_id as string | null,
        auth_password_enc: data.auth_password_enc as string | null,
      })
      if (password) {
        const authClient = createClient(url, anon, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
        const { data: signIn, error: signErr } = await authClient.auth.signInWithPassword({
          email: edgeAuthEmail(data.id),
          password,
        })
        if (!signErr && signIn?.session?.access_token) {
          body.scoped_access_token = signIn.session.access_token
          body.scoped_expires_at = signIn.session.expires_at ?? undefined
        }
      }
    } catch {
      // provisioning/復号/サインイン失敗は無視（scoped を返さないだけ）。
    }
  }

  // service_role は返さない (冒頭の説明・2026-11-13)。応答に載せる行そのものを置かない

  // エッジごとの鍵 (packages/shared/src/secret-codec.ts)。マスタ鍵が無ければ付けない
  const sk = edgeSecretKeysFor(data.id as string)
  if (sk) body.secret_keys = sk

  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
