import { describe, expect, it, vi } from 'vitest'
import type { OAuthGrant } from '@supabase/supabase-js'
import { activeGrants, formatJst, GRANT_MAX_AGE_DAYS, grantExpired, grantExpiresAt, validClientId } from './gvms-grants'

const NOW = new Date('2026-10-30T00:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString()
const grant = (id: string, grantedAt: string): OAuthGrant => ({
  client: { id, name: `G・VMS ${id}`, uri: '', logo_uri: '' }, scopes: ['openid'], granted_at: grantedAt,
})

describe('許可の期限 (ASVS 10.4.9・10.7.2)', () => {
  it(`承認から ${GRANT_MAX_AGE_DAYS} 日で切れる`, () => {
    expect(grantExpiresAt('2026-10-01T00:00:00Z')?.toISOString())
      .toBe(new Date(Date.parse('2026-10-01T00:00:00Z') + GRANT_MAX_AGE_DAYS * DAY).toISOString())
    expect(grantExpired(ago(GRANT_MAX_AGE_DAYS - 1), NOW)).toBe(false)
    expect(grantExpired(ago(GRANT_MAX_AGE_DAYS), NOW)).toBe(true)
    expect(grantExpired(ago(GRANT_MAX_AGE_DAYS + 30), NOW)).toBe(true)
  })

  it('日時の読めない許可は切れたものとして扱う', () => {
    for (const bad of [null, undefined, '', 'x']) {
      expect(grantExpiresAt(bad)).toBeNull()
      expect(grantExpired(bad, NOW)).toBe(true)
    }
  })
})

describe('activeGrants', () => {
  const A = '11111111-1111-4111-8111-111111111111'
  const B = '22222222-2222-4222-8222-222222222222'

  it('期限の過ぎた許可は本人の接続で取り消し、一覧から外す', async () => {
    const revokeGrant = vi.fn().mockResolvedValue({ data: {}, error: null })
    const listGrants = vi.fn().mockResolvedValue({ data: [grant(A, ago(1)), grant(B, ago(200))], error: null })
    const out = await activeGrants({ listGrants, revokeGrant }, NOW)
    expect(revokeGrant).toHaveBeenCalledTimes(1)
    expect(revokeGrant).toHaveBeenCalledWith({ clientId: B })
    expect(out?.map((g) => [g.grant.client.id, g.expired])).toEqual([[A, false]])
  })

  it('取り消しに失敗した許可は期限切れの印を付けて残す (同意の画面はこれを見て止める)', async () => {
    const revokeGrant = vi.fn().mockResolvedValue({ data: null, error: new Error('x') })
    const listGrants = vi.fn().mockResolvedValue({ data: [grant(B, ago(200))], error: null })
    const out = await activeGrants({ listGrants, revokeGrant }, NOW)
    expect(out?.map((g) => [g.grant.client.id, g.expired])).toEqual([[B, true]])
  })

  it('一覧を読めなければ null', async () => {
    const out = await activeGrants({
      listGrants: vi.fn().mockResolvedValue({ data: null, error: new Error('disabled') }),
      revokeGrant: vi.fn(),
    }, NOW)
    expect(out).toBeNull()
  })
})

describe('形と表示', () => {
  it('クライアント ID は UUID だけ', () => {
    expect(validClientId('11111111-1111-4111-8111-111111111111')).toBe(true)
    for (const bad of ['', 'abc', '../x', null, 1, '11111111-1111-4111-8111-11111111111g']) {
      expect(validClientId(bad)).toBe(false)
    }
  })

  it('日時は日本時間で出す', () => {
    expect(formatJst('2026-10-29T15:30:00Z')).toBe('2026/10/30 00:30')
    expect(formatJst(null)).toBe('—')
    expect(formatJst('x')).toBe('—')
  })
})
