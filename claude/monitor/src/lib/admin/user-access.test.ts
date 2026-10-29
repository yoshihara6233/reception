import { describe, expect, it } from 'vitest'
import { auditActionOf, decideUserAccess, isSuspended, suspendedAuthUserIds } from './user-access'

const TA = '00000000-0000-0000-0000-0000000000a1'
const TB = '00000000-0000-0000-0000-0000000000b1'

describe('decideUserAccess', () => {
  const superAdmin = { authUserId: 'su', role: 'super_admin', tenantId: null }
  const tenantAdminA = { authUserId: 'ta', role: 'tenant_admin', tenantId: TA }

  it('super_admin はどの利用者も操作できる (自分は除く)', () => {
    expect(decideUserAccess(superAdmin, { authUserId: 'u1', role: 'viewer', tenantId: TB })).toEqual({ ok: true })
    expect(decideUserAccess(superAdmin, { authUserId: 'su2', role: 'super_admin', tenantId: null })).toEqual({ ok: true })
  })

  it('tenant_admin は自分のテナントの利用者だけ。super_admin とテナントの無い利用者には触れない', () => {
    expect(decideUserAccess(tenantAdminA, { authUserId: 'u1', role: 'viewer', tenantId: TA })).toEqual({ ok: true })
    expect(decideUserAccess(tenantAdminA, { authUserId: 'u2', role: 'viewer', tenantId: TB }))
      .toEqual({ ok: false, status: 403, error: 'cross_tenant_forbidden' })
    expect(decideUserAccess(tenantAdminA, { authUserId: 'su', role: 'super_admin', tenantId: TA }))
      .toEqual({ ok: false, status: 403, error: 'cross_tenant_forbidden' })
    expect(decideUserAccess(tenantAdminA, { authUserId: 'u3', role: 'viewer', tenantId: null }))
      .toEqual({ ok: false, status: 403, error: 'cross_tenant_forbidden' })
  })

  it('管理者でないロールは操作できない', () => {
    for (const role of ['store_manager', 'baggage_manager', 'viewer']) {
      expect(decideUserAccess({ authUserId: 'x', role, tenantId: TA }, { authUserId: 'u1', role: 'viewer', tenantId: TA }))
        .toEqual({ ok: false, status: 403, error: 'insufficient_role' })
    }
  })

  it('自分自身・ログインの紐付けが無い利用者は対象にしない', () => {
    expect(decideUserAccess(tenantAdminA, { authUserId: 'ta', role: 'tenant_admin', tenantId: TA }))
      .toEqual({ ok: false, status: 400, error: 'cannot_target_self' })
    expect(decideUserAccess(tenantAdminA, { authUserId: null, role: 'viewer', tenantId: TA }))
      .toEqual({ ok: false, status: 409, error: 'not_linked' })
  })
})

describe('isSuspended', () => {
  const now = new Date('2026-10-30T00:00:00Z')
  it('期限が先にあれば止めている', () => {
    expect(isSuspended('2126-10-30T00:00:00Z', now)).toBe(true)
  })
  it('期限が過ぎた・無い・壊れている ときは止めていない', () => {
    expect(isSuspended('2026-10-29T00:00:00Z', now)).toBe(false)
    expect(isSuspended(null, now)).toBe(false)
    expect(isSuspended(undefined, now)).toBe(false)
    expect(isSuspended('not-a-date', now)).toBe(false)
  })
})

describe('auditActionOf', () => {
  it('監査ログの action の名前', () => {
    expect(auditActionOf('suspend')).toBe('user.suspend')
    expect(auditActionOf('resume')).toBe('user.resume')
    expect(auditActionOf('revoke_sessions')).toBe('user.sessions_revoke')
  })
})

describe('suspendedAuthUserIds', () => {
  it('期限が先にある人だけを返し、紐付けの無い行は問い合わせない', async () => {
    const calls: unknown[] = []
    const svc = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push([fn, args])
        return { data: [
          { user_id: 'a', banned_until: '2126-01-01T00:00:00Z' },
          { user_id: 'b', banned_until: null },
          { user_id: 'c', banned_until: '2000-01-01T00:00:00Z' },
        ], error: null }
      },
    }
    const got = await suspendedAuthUserIds(svc, ['a', null, 'b', 'c'])
    expect([...got]).toEqual(['a'])
    expect(calls).toEqual([['user_suspension_states', { p_users: ['a', 'b', 'c'] }]])
  })
  it('読めないときは空 (一覧は出し続ける)。対象が無ければ呼ばない', async () => {
    const failing = { rpc: async () => ({ data: null, error: { message: 'x' } }) }
    expect((await suspendedAuthUserIds(failing, ['a'])).size).toBe(0)
    let called = false
    const spy = { rpc: async () => { called = true; return { data: [], error: null } } }
    expect((await suspendedAuthUserIds(spy, [null])).size).toBe(0)
    expect(called).toBe(false)
  })
})
