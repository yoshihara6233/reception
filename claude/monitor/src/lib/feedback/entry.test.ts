import { describe, expect, it, vi } from 'vitest'

/**
 * 「要望・困りごと」の入口を出すのはテナント管理者だけ（基本設計 §3.1）。
 *   - super_admin（運営）・store_manager・viewer・baggage_manager には出さない
 *   - テナントが要望の受付を止めていれば、テナント管理者にも出さない
 *   - 設定の左メニューの「要望」も同じ判定に従う
 */

vi.mock('@/lib/tenant/session', () => ({ getAdminUserRow: async () => null }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({}),
  createSupabaseService: () => ({}),
}))

import { feedbackEntryAllowed } from './entry'

const on = async () => true
const off = async () => false

describe('feedbackEntryAllowed', () => {
  it('テナント管理者で、テナントが止めていなければ出す', async () => {
    expect(await feedbackEntryAllowed({ role: 'tenant_admin', tenant_id: 't1' }, on)).toBe(true)
  })

  it.each(['super_admin', 'store_manager', 'viewer', 'baggage_manager'])('★%s には出さない', async (role) => {
    const asked: string[] = []
    const allowed = await feedbackEntryAllowed({ role, tenant_id: 't1' }, async (t) => { asked.push(t); return true })
    expect(allowed).toBe(false)
    // テナントの設定を見る前に断る（判定に要らない問い合わせをしない）
    expect(asked).toEqual([])
  })

  it('★テナントが要望の受付を止めていれば、テナント管理者にも出さない', async () => {
    expect(await feedbackEntryAllowed({ role: 'tenant_admin', tenant_id: 't1' }, off)).toBe(false)
  })

  it('未ログイン・テナントに属さない利用者には出さない', async () => {
    expect(await feedbackEntryAllowed(null, on)).toBe(false)
    expect(await feedbackEntryAllowed({ role: 'tenant_admin', tenant_id: null }, on)).toBe(false)
  })
})

describe('設定の左メニュー（getAdminNav）', () => {
  it('★「要望」は判定が通ったときだけ・「要望ボード」は運営だけ', async () => {
    const { getAdminNav } = await import('@/components/AdminShell')
    const t = { adminNav: { stores: '拠点', users: 'ユーザ', audit: 'アクセスログ', edges: 'エッジ', limits: '視聴上限' } } as never
    const hrefs = (o: Parameters<typeof getAdminNav>[1]) => getAdminNav(t, o).map((n) => n.href)

    expect(hrefs({ feedback: true })).toContain('/settings/feedback')
    expect(hrefs({ feedback: false })).not.toContain('/settings/feedback')
    expect(hrefs({ feedback: false })).not.toContain('/admin/feedback')
    expect(hrefs({ isSuper: true, feedback: false })).toContain('/admin/feedback')
    expect(hrefs({ isSuper: true, feedback: false })).not.toContain('/settings/feedback')
  })

  it('★「要望ボード」に未対応の件数を載せる (0・null は印なし)', async () => {
    const { getAdminNav } = await import('@/components/AdminShell')
    const t = { adminNav: { stores: '拠点', users: 'ユーザ', audit: 'アクセスログ', edges: 'エッジ', limits: '視聴上限' } } as never
    const board = (n: number | null) => getAdminNav(t, { isSuper: true, feedbackUntouched: n }).find((e) => e.href === '/admin/feedback')!
    expect(board(2)).toMatchObject({ count: 2, countLabel: '未対応' })
    expect(board(null).count).toBeNull()
  })

  it('★テナント管理者の「要望」に、返事が付いてまだ見ていない件数を載せる (0・null は印なし)', async () => {
    const { getAdminNav } = await import('@/components/AdminShell')
    const t = { adminNav: { stores: '拠点', users: 'ユーザ', audit: 'アクセスログ', edges: 'エッジ', limits: '視聴上限' } } as never
    const mine = (n: number | null | undefined) => getAdminNav(t, { feedback: true, feedbackUnseen: n }).find((e) => e.href === '/settings/feedback')!
    expect(mine(3)).toMatchObject({ count: 3, countLabel: '新着の返事・状態' })
    expect(mine(0).count).toBe(0)
    expect(mine(null).count).toBeNull()
    expect(mine(undefined).count).toBeNull()
    // 受付を止めたテナント（feedback=false）は件数があっても項目ごと出さない
    expect(getAdminNav(t, { feedback: false, feedbackUnseen: 3 }).map((e) => e.href)).not.toContain('/settings/feedback')
  })
})
