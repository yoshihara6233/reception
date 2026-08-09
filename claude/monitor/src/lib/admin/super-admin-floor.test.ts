import { describe, expect, it } from 'vitest'
import { checkSuperAdminFloor } from './super-admin-floor'

/** admin_users の件数クエリだけを模した最小のスタブ。 */
function svcWith(superAdminCount: number) {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ count: superAdminCount, error: null }),
      }),
    }),
    // deno-lint-ignore no-explicit-any
  } as never
}

describe('checkSuperAdminFloor', () => {
  it('super_admin 以外の削除・変更は素通しする', async () => {
    expect(await checkSuperAdminFloor(svcWith(1), 'tenant_admin', null)).toEqual({ ok: true })
    expect(await checkSuperAdminFloor(svcWith(1), 'viewer', 'store_manager')).toEqual({ ok: true })
  })

  it('super_admin のままなら人数が減らないので許す', async () => {
    expect(await checkSuperAdminFloor(svcWith(1), 'super_admin', 'super_admin')).toEqual({ ok: true })
  })

  it('最後の 1 人の削除を拒否する', async () => {
    const r = await checkSuperAdminFloor(svcWith(1), 'super_admin', null)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('last_super_admin')
  })

  it('最後の 1 人の降格も拒否する（削除だけ塞いでも自己降格で抜けられるため）', async () => {
    const r = await checkSuperAdminFloor(svcWith(1), 'super_admin', 'tenant_admin')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('last_super_admin')
  })

  it('2 人以上いれば削除・降格を許す', async () => {
    expect(await checkSuperAdminFloor(svcWith(2), 'super_admin', null)).toEqual({ ok: true })
    expect(await checkSuperAdminFloor(svcWith(3), 'super_admin', 'viewer')).toEqual({ ok: true })
  })

  it('0 人の異常状態でも削除を拒否する（さらに減らさない）', async () => {
    const r = await checkSuperAdminFloor(svcWith(0), 'super_admin', null)
    expect(r.ok).toBe(false)
  })
})
