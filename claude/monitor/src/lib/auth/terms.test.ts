import { afterEach, describe, expect, it } from 'vitest'
import { termsRequiredForRole, termsUrl, termsVersion } from './terms'

afterEach(() => { delete process.env.TERMS_VERSION; delete process.env.TERMS_URL })

describe('利用約款への同意（G-9）', () => {
  it('版が空のあいだは求めない', () => {
    expect(termsVersion()).toBe('')
    process.env.TERMS_VERSION = ' 2026-11-24 '
    expect(termsVersion()).toBe('2026-11-24')
  })
  it('掲載先の既定は製品のサイト', () => {
    expect(termsUrl()).toBe('https://g-vms.com/terms')
    process.env.TERMS_URL = 'https://example.jp/terms'
    expect(termsUrl()).toBe('https://example.jp/terms')
  })
  it('求めるのはテナント管理者だけ（運営・ほかの役割には求めない）', () => {
    expect(termsRequiredForRole('tenant_admin')).toBe(true)
    for (const r of ['super_admin', 'store_manager', 'viewer', 'baggage_manager', null]) {
      expect(termsRequiredForRole(r)).toBe(false)
    }
  })
})
