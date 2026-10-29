import { describe, expect, it } from 'vitest'
import { gvmsRoleFor, validAuthorizationId } from './gvms-consent'

const T = 'tenant-a', S = 'store-a1'

describe('拠点に入れるか (gvms_access_token_hook と同じ読み替え・ASVS 10.7.1)', () => {
  it.each([
    [{ role: 'super_admin', tenant_id: null, store_ids: [] }, 'admin'],
    [{ role: 'tenant_admin', tenant_id: T, store_ids: [] }, 'manager'],
    [{ role: 'store_manager', tenant_id: T, store_ids: [S] }, 'operator'],
    [{ role: 'baggage_manager', tenant_id: T, store_ids: [S] }, 'operator'],
    [{ role: 'viewer', tenant_id: T, store_ids: [S] }, 'viewer'],
  ])('%o → %s', (p, want) => {
    expect(gvmsRoleFor(p, S, T)).toBe(want)
  })

  it.each([
    ['別テナントの管理者', { role: 'tenant_admin', tenant_id: 'tenant-b', store_ids: [] }],
    ['担当でない店舗の店長', { role: 'store_manager', tenant_id: T, store_ids: ['store-a2'] }],
    ['担当でない店舗の閲覧者', { role: 'viewer', tenant_id: T, store_ids: [] }],
    ['テナントの無い管理者', { role: 'tenant_admin', tenant_id: null, store_ids: [] }],
  ])('%s は入れない', (_n, p) => {
    expect(gvmsRoleFor(p, S, T)).toBeNull()
  })

  it('利用者の行が無ければ入れない', () => {
    expect(gvmsRoleFor(null, S, T)).toBeNull()
  })
})

describe('authorization_id の形', () => {
  it('英数字と - _ だけ・128 文字まで', () => {
    expect(validAuthorizationId('abc-123_X')).toBe(true)
    for (const bad of ['', 'a/b', 'a b', '../x', 'x'.repeat(129), null, 1]) {
      expect(validAuthorizationId(bad)).toBe(false)
    }
  })
})
