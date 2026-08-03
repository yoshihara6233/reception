/**
 * エッジ ブートストラップ（鍵ローテ無停止同期 / Phase A + スコープ鍵化 Phase B1）。
 *
 * エッジが `x-device-token` で認証し、現行の Supabase URL + service key を取得する。
 * これにより Supabase 鍵をローテしても、エッジの .env を手で書き換えずに追従できる。
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
 * 認証: edge_devices.device_token と一致するトークンのみ。
 *
 * ⚠ 移行中は service_role も従来通り返す。Phase B4（全エッジがスコープ運用に載ったら）で
 *   service_role 返却を撤廃し、device_token 漏洩時の影響限定を完成させる。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseService } from '@/lib/supabase/server'
import { edgeAuthEmail, ensureEdgeAuthPassword, mayWithholdServiceRole } from '@/lib/edge/auth-provision'

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

  // device_token を検証（monitor の env キーで RLS バイパス参照）。
  const supa = createSupabaseService()
  const { data, error } = await supa
    .from('edge_devices')
    .select('id, store_id, scoped_only, auth_user_id, auth_password_enc, desired_agent_version, desired_cloudflared_version')
    .eq('device_token', token)
    .single()
  if (error || !data) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const body: {
    edge_id: string
    supabase_url: string
    // Phase B4: scoped_only なエッジには返さない（下の安全装置つき）。
    supabase_service_role_key?: string
    scoped_access_token?: string
    scoped_expires_at?: number
    // 自律OTA: 本部が宣言する目標版（NULL=更新指示なし）。エッジは pull で受けて
    // shouldUpdateAgent 判断のうえ self-update する（docs/edge-ota-design.md）。
    desired_agent_version?: string | null
    desired_cloudflared_version?: string | null
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
  // 失敗しても 200（service_role 経路は維持）— 無停止のための後方互換。
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

  // Phase B4: scoped_only なエッジには service_role を返さない。
  //
  // ただし省くのは「このエッジが確実にスコープトークンを持っている」と言える時だけ:
  //   - この応答で新しく発行できた（scoped_access_token あり）
  //   - もしくはエッジが x-scoped-until でまだ有効だと申告している（stillFresh）
  // どちらでもない＝代替手段が無い応答で鍵まで止めるとエッジが丸腰になるため、
  // その場合は従来どおり返して次の pull で復帰させる（フェイルセーフ）。
  const withhold = mayWithholdServiceRole({
    scopedOnly: data.scoped_only === true,
    mintedToken: !!body.scoped_access_token,
    clientTokenStillFresh: stillFresh,
  })
  if (!withhold) body.supabase_service_role_key = key

  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
