// 役割ごとの入口の出し分け (2026-11-04・シナリオ試験の所見)
import { describe, it, expect } from 'vitest'
import { filterNavForRole, canOpenModule, canManage, isTenantAdminOrSuper } from './role-menu'

const NAV = [
  { href: '/admin/reports/usage' },
  { href: '/admin/stores' },
  { href: '/admin/users' },
  { href: '/admin/fleet' },
  { href: '/admin/baggage' },
  { href: '/admin/bcp' },
  { href: '/admin/audit' },
  { href: '#ops', heading: true },
  { href: '/admin/tenants' },
]
const hrefs = (r: string | null) => filterNavForRole(NAV, r).map((n) => n.href)

describe('filterNavForRole', () => {
  it('閲覧者には利用状況レポートだけ (設定の項目は出さない)', () => {
    expect(hrefs('viewer')).toEqual(['/admin/reports/usage', '#ops', '/admin/tenants'])
  })
  it('拠点管理者には手荷物検査設定を出さない', () => {
    expect(hrefs('store_manager')).not.toContain('/admin/baggage')
    expect(hrefs('store_manager')).toContain('/admin/stores')
  })
  it('テナント管理者・全体管理者・役割不明は全部', () => {
    for (const r of ['tenant_admin', 'super_admin', null]) expect(hrefs(r)).toEqual(NAV.map((n) => n.href))
  })
  it('下に項目が残らない見出しは除く', () => {
    const nav = [{ href: '/admin/stores' }, { href: '#x', heading: true }, { href: '/security/settings' }]
    expect(filterNavForRole(nav, 'viewer')).toEqual([])
  })
  it('各機能の設定とテスト発令は閲覧者に出さない', () => {
    const nav = [{ href: '/security/settings' }, { href: '/alarms/settings' }, { href: '/bcp/test' }, { href: '/bcp' }]
    expect(filterNavForRole(nav, 'viewer').map((n) => n.href)).toEqual(['/bcp'])
    expect(filterNavForRole(nav, 'store_manager')).toHaveLength(4)
  })
})

describe('CSV 一括投入 (2026-11-05)', () => {
  it('拠点管理者には出さない・テナント管理者以上には出す (受け口の requireTenantAdminOrSuper と同じ)', () => {
    const nav = [{ href: '/admin/import' }]
    expect(filterNavForRole(nav, 'store_manager')).toEqual([])
    expect(filterNavForRole(nav, 'viewer')).toEqual([])
    expect(filterNavForRole(nav, 'tenant_admin')).toEqual(nav)
    expect(filterNavForRole(nav, 'super_admin')).toEqual(nav)
  })
})

describe('canOpenModule', () => {
  it('手荷物検査店長は /baggage だけ', () => {
    expect(canOpenModule('/baggage', 'baggage_manager')).toBe(true)
    for (const h of ['/stores', '/bcp', '/security/reports', '/alarms']) expect(canOpenModule(h, 'baggage_manager')).toBe(false)
  })
  it('他の役割は制限しない', () => {
    expect(canOpenModule('/stores', 'viewer')).toBe(true)
  })
})

describe('サーバ側と同じ条件', () => {
  it('書き込みの担当 = super_admin・tenant_admin・store_manager (requireAdmin・can_manage_store)', () => {
    expect(['super_admin', 'tenant_admin', 'store_manager', 'viewer', 'baggage_manager'].filter(canManage))
      .toEqual(['super_admin', 'tenant_admin', 'store_manager'])
  })
  it('テナント管理者以上 = super_admin・tenant_admin', () => {
    expect(['super_admin', 'tenant_admin', 'store_manager', 'viewer'].filter(isTenantAdminOrSuper))
      .toEqual(['super_admin', 'tenant_admin'])
  })
})
