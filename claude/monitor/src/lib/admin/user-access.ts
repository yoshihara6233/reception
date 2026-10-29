/**
 * 利用者の「利用を止める／戻す」「セッションを切る」の判定 (2026-10-30・自主診断 ASVS 7.4.2・7.4.5)。
 *
 * 権限は利用者の編集 (PUT /api/admin/users/[id])・多要素を外す (mfa-reset) と同じ強さ:
 *   - super_admin: どの利用者も
 *   - tenant_admin: 自分のテナントの利用者だけ。super_admin には触れない
 * 加えて自分自身は対象にしない (自分を締め出さない。自分のセッションはログアウトで切れる)。
 */

export const USER_ACCESS_ACTIONS = ['suspend', 'resume', 'revoke_sessions'] as const
export type UserAccessAction = typeof USER_ACCESS_ACTIONS[number]

/** 止めるときの ban の長さ (Supabase Auth の ban_duration)。実質は「戻すまで」。 */
export const SUSPEND_BAN_DURATION = '876000h'   // 100 年
/** 戻すとき (ban を外す)。 */
export const RESUME_BAN_DURATION = 'none'

export interface AccessActor {
  authUserId: string
  role: string
  tenantId: string | null
}

export interface AccessTarget {
  authUserId: string | null
  role: string
  tenantId: string | null
}

export type AccessDecision =
  | { ok: true }
  | { ok: false; status: number; error: string }

/** その管理者がその利用者に操作してよいか。 */
export function decideUserAccess(actor: AccessActor, target: AccessTarget): AccessDecision {
  if (actor.role !== 'super_admin' && actor.role !== 'tenant_admin') {
    return { ok: false, status: 403, error: 'insufficient_role' }
  }
  if (actor.role === 'tenant_admin' &&
      (target.tenantId === null || target.tenantId !== actor.tenantId || target.role === 'super_admin')) {
    return { ok: false, status: 403, error: 'cross_tenant_forbidden' }
  }
  if (!target.authUserId) return { ok: false, status: 409, error: 'not_linked' }
  if (target.authUserId === actor.authUserId) return { ok: false, status: 400, error: 'cannot_target_self' }
  return { ok: true }
}

/** banned_until から「止めているか」。期限が過ぎていれば止めていない。 */
export function isSuspended(bannedUntil: string | null | undefined, now: Date = new Date()): boolean {
  if (!bannedUntil) return false
  const t = Date.parse(bannedUntil)
  return Number.isFinite(t) && t > now.getTime()
}

/** 監査ログの action の名前。 */
export function auditActionOf(action: UserAccessAction): string {
  switch (action) {
    case 'suspend':         return 'user.suspend'
    case 'resume':          return 'user.resume'
    case 'revoke_sessions': return 'user.sessions_revoke'
  }
}

/** rpc を呼べる最小限の形 (サービスの接続)。 */
interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
}

/**
 * 一覧の画面用: 止めている利用者の auth の id の集合。読めなかったときは空 (一覧は出し続ける)。
 * サービスの接続で呼ぶこと (user_suspension_states は service_role だけが実行できる)。
 */
export async function suspendedAuthUserIds(svc: RpcClient, authUserIds: ReadonlyArray<string | null>): Promise<Set<string>> {
  const ids = authUserIds.filter((x): x is string => !!x)
  if (ids.length === 0) return new Set()
  const { data, error } = await svc.rpc('user_suspension_states', { p_users: ids })
  if (error || !Array.isArray(data)) return new Set()
  const now = new Date()
  return new Set((data as { user_id: string; banned_until: string | null }[])
    .filter((r) => isSuspended(r.banned_until, now)).map((r) => r.user_id))
}
