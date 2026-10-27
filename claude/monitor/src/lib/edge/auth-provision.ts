/**
 * エッジ専用 Supabase Auth ユーザの provisioning（エッジ専用スコープ鍵化 Phase B2）。
 *
 * エッジ1台につき Auth ユーザを1つ持たせ、その JWT の app_metadata.edge_id を RLS が見る。
 * bootstrap はこのユーザで signInWithPassword して短命トークンを発行する。
 *
 * ここに置く理由: 以前は `scripts/provision-edge-auth.ts` を **人が手で** 実行する前提
 * だった。それだと新規エンロールのたびに手作業が要り、やり忘れたエッジは scoped トークンを
 * 受け取れない。Phase B4（bootstrap から service_role 返却を撤廃）に入ると
 * 「provisioning 忘れ ＝ そのエッジが何もできない」になるため、**enroll と bootstrap の
 * 両方から自動で呼べる形**に切り出した。スクリプトは強制ローテ用の薄い入口として残す。
 *
 * ⚠ SECRETS_ENC_KEY 未設定の環境では provisioning しない。encryptSecret が `plain:` に
 *   フォールバックするため、パスワードが DB に平文同然で載ってしまうため。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { encryptSecret, decryptSecret } from '@intereco/shared'

/** エッジ auth ユーザのメール（edge_id から決定的に導出）。 */
export function edgeAuthEmail(edgeId: string): string {
  return `edge+${edgeId}@edge.intereco.local`
}

/** アプリ層 Vault が使えるか（使えないなら provisioning しない）。 */
export function canProvisionEdgeAuth(): boolean {
  return !!process.env.SECRETS_ENC_KEY
}

export interface EdgeAuthRow {
  id: string
  store_id: string
  auth_user_id?: string | null
  auth_password_enc?: string | null
}

/**
 * エッジの auth ユーザを用意し、サインイン用パスワードを返す。
 *
 * - 既に provisioning 済み（auth_user_id と auth_password_enc が揃っている）なら
 *   保存済みパスワードを復号して返すだけ（毎回のパスワードローテはしない）。
 * - 未 provisioning / 片肺なら作成 or 更新して edge_devices に保存する。
 * - 失敗・鍵未設定は null（呼び出し側は scoped トークンを出さずに続行する）。
 *
 * `svc` は service_role クライアント（Auth Admin API と edge_devices 更新に必要）。
 */
export async function ensureEdgeAuthPassword(
  svc: SupabaseClient,
  edge: EdgeAuthRow,
  opts: { rotate?: boolean } = {},
): Promise<string | null> {
  if (!canProvisionEdgeAuth()) return null

  if (!opts.rotate && edge.auth_user_id && edge.auth_password_enc) {
    try {
      return decryptSecret(edge.auth_password_enc)
    } catch {
      // 復号できない（鍵ローテ等）→ 作り直す。
    }
  }

  // app_metadata は service_role でしか書けない＝エッジ側から詐称できないクレーム。
  // store_id / tenant_id も入れるが、RLS が信じるのは edge_id だけ（機器入替で
  // 陳腐化するため、店舗/テナントは DB から引き直す。migration 側のコメント参照）。
  const { data: store } = await svc
    .from('stores')
    .select('tenant_id')
    .eq('id', edge.store_id)
    .maybeSingle()

  const email = edgeAuthEmail(edge.id)
  const password = randomBytes(24).toString('base64url')
  const app_metadata = {
    edge_id: edge.id,
    store_id: edge.store_id,
    tenant_id: (store as { tenant_id?: string } | null)?.tenant_id ?? null,
    role: 'edge',
  }

  let authUserId = edge.auth_user_id ?? null
  let justCreated = false
  if (!authUserId) {
    const { data: created } = await svc.auth.admin.createUser({
      email, password, email_confirm: true, app_metadata,
    })
    if (created?.user) {
      authUserId = created.user.id
      justCreated = true
    } else {
      // 同 email が既にある（bootstrap 同時実行での競合・過去の片肺）→ 引き当てて更新に回す。
      const { data: list } = await svc.auth.admin.listUsers({ perPage: 200 })
      authUserId = list?.users?.find((u) => u.email === email)?.id ?? null
      if (!authUserId) return null
    }
  }

  if (!justCreated) {
    const { error: updErr } = await svc.auth.admin.updateUserById(authUserId, {
      password, email_confirm: true, app_metadata,
    })
    if (updErr) return null
  }

  const { error: wErr } = await svc
    .from('edge_devices')
    .update({ auth_user_id: authUserId, auth_password_enc: encryptSecret(password) })
    .eq('id', edge.id)
  if (wErr) return null

  return password
}

/**
 * Phase B4: この応答で `supabase_service_role_key` を省いてよいか。
 *
 * 省いてよいのは「このエッジが確実にスコープトークンを持っている」と言える時だけ。
 * 代替手段が無い応答で鍵まで止めると、そのエッジは何もできなくなる（＝丸腰）。
 * bootstrap は5分ごとに来るので、1回見送っても次で締まる。**安全側に倒す。**
 */
export function mayWithholdServiceRole(opts: {
  /** edge_devices.scoped_only — 本部が「このエッジには配らない」と宣言している */
  scopedOnly: boolean
  /** この応答でスコープトークンを新規発行できた */
  mintedToken: boolean
  /** エッジが x-scoped-until で「手持ちがまだ有効」と申告している */
  clientTokenStillFresh: boolean
  /**
   * G・VMS 本体の内蔵アップリンク (nvmsd) か。**真なら無条件で省く。**
   *
   * nvmsd は bootstrap を一度も使わず、service_role を必要としない (G・VMS 側の
   * internal/uplink に呼び出しが無い)。一方でその device_token は現場のサーバの
   * /etc/nvms/uplink.env に置かれ、現場の管理者や販売店が root で読める。ここで鍵を
   * 返すと、1 拠点のトークンの漏れが全テナントの DB・置き場の読み書きになる
   * (2026-10-28 の自主診断で発見)。丸腰の心配 (上の安全装置) も、使わない鍵には当たらない。
   */
  gvmsUplink?: boolean
}): boolean {
  if (opts.gvmsUplink) return true
  return opts.scopedOnly && (opts.mintedToken || opts.clientTokenStillFresh)
}

/**
 * このエッジが G・VMS 本体の内蔵アップリンク (nvmsd) か。
 *
 * 次のどれか 1 つでも当たれば G・VMS とみなす (どれも G・VMS にしか付かない印):
 *   - heartbeat の agent_version が `nvmsd/` で始まる (管理画面・艦隊集計と同じ見分け方)
 *   - vendor='nvms' のレコーダを持つ (エンロールで自動で作る)
 *   - kind='nvms' のエンロールトークンで登録された (最初の heartbeat の前でも当たる)
 *
 * 照会に失敗したときは false (= 従来どおり) を返す。試作のエッジ箱 (intereco-edge) は
 * まだ service_role で動くため、DB の一時的な失敗で鍵を止めると止まってしまう。
 * G・VMS の拠点は agent_version でたいてい先に当たる。
 */
export async function isGvmsUplinkEdge(
  svc: SupabaseClient,
  edge: { id: string; agent_version?: string | null },
): Promise<boolean> {
  if (edge.agent_version?.startsWith('nvmsd/')) return true
  const [rec, tok] = await Promise.all([
    svc.from('recorders').select('id').eq('edge_id', edge.id).eq('vendor', 'nvms').limit(1),
    svc.from('enrollment_tokens').select('id').eq('edge_id', edge.id).eq('kind', 'nvms').limit(1),
  ])
  if (rec.error || tok.error) {
    console.error('[bootstrap] gvms uplink lookup failed', rec.error?.message ?? tok.error?.message)
  }
  return (rec.data?.length ?? 0) > 0 || (tok.data?.length ?? 0) > 0
}
