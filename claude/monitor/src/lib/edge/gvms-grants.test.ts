import { describe, expect, it, vi } from 'vitest'
import type { OAuthGrant } from '@supabase/supabase-js'
import { activeGrants, formatJst, GRANT_MAX_AGE_DAYS, grantExpired, grantExpiresAt, readLastUsed, validClientId } from './gvms-grants'

const NOW = new Date('2026-10-30T00:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString()
const grant = (id: string, grantedAt: string): OAuthGrant => ({
  client: { id, name: `G・VMS ${id}`, uri: '', logo_uri: '' }, scopes: ['openid'], granted_at: grantedAt,
})

describe('許可の期限 (ASVS 10.4.9・10.7.2・案 B: 最後に使ってから 90 日)', () => {
  it(`使った記録が無ければ承認から ${GRANT_MAX_AGE_DAYS} 日で切れる`, () => {
    expect(grantExpiresAt('2026-10-01T00:00:00Z')?.toISOString())
      .toBe(new Date(Date.parse('2026-10-01T00:00:00Z') + GRANT_MAX_AGE_DAYS * DAY).toISOString())
    expect(grantExpired(ago(GRANT_MAX_AGE_DAYS - 1), null, NOW)).toBe(false)
    expect(grantExpired(ago(GRANT_MAX_AGE_DAYS), null, NOW)).toBe(true)
    expect(grantExpired(ago(GRANT_MAX_AGE_DAYS + 30), undefined, NOW)).toBe(true)
  })

  it(`最後に使ってから ${GRANT_MAX_AGE_DAYS} 日で切れる (使っている間は切れない)`, () => {
    // 承認は 200 日前でも、10 日前に使っていれば切れない
    expect(grantExpired(ago(200), ago(10), NOW)).toBe(false)
    expect(grantExpiresAt(ago(200), ago(10))?.toISOString())
      .toBe(new Date(NOW.getTime() + (GRANT_MAX_AGE_DAYS - 10) * DAY).toISOString())
    expect(grantExpired(ago(200), ago(GRANT_MAX_AGE_DAYS - 1), NOW)).toBe(false)
    expect(grantExpired(ago(200), ago(GRANT_MAX_AGE_DAYS), NOW)).toBe(true)
  })

  it('承認と最後に使った時刻の新しいほうから数える', () => {
    // 取り消してから承認し直した許可: 古い使った記録より、新しい承認が効く
    expect(grantExpiresAt(ago(5), ago(100))?.toISOString())
      .toBe(new Date(NOW.getTime() + (GRANT_MAX_AGE_DAYS - 5) * DAY).toISOString())
    expect(grantExpired(ago(5), ago(100), NOW)).toBe(false)
    // 両方とも古ければ切れる
    expect(grantExpired(ago(GRANT_MAX_AGE_DAYS + 1), ago(GRANT_MAX_AGE_DAYS), NOW)).toBe(true)
  })

  it('最後に使った時刻が読めなければ承認から数える (期限が早まる側)', () => {
    for (const bad of [null, undefined, '', 'x']) {
      expect(grantExpiresAt(ago(10), bad)?.toISOString())
        .toBe(new Date(NOW.getTime() + (GRANT_MAX_AGE_DAYS - 10) * DAY).toISOString())
    }
  })

  it('承認の日時の読めない許可は、使った記録があっても切れたものとして扱う', () => {
    for (const bad of [null, undefined, '', 'x']) {
      expect(grantExpiresAt(bad)).toBeNull()
      expect(grantExpiresAt(bad, ago(1))).toBeNull()
      expect(grantExpired(bad, ago(1), NOW)).toBe(true)
    }
  })
})

describe('activeGrants', () => {
  const A = '11111111-1111-4111-8111-111111111111'
  const B = '22222222-2222-4222-8222-222222222222'
  const C = '33333333-3333-4333-8333-333333333333'
  const none = new Map<string, string>()

  it('期限の過ぎた許可は本人の接続で取り消し、一覧から外す', async () => {
    const revokeGrant = vi.fn().mockResolvedValue({ data: {}, error: null })
    const listGrants = vi.fn().mockResolvedValue({ data: [grant(A, ago(1)), grant(B, ago(200))], error: null })
    const out = await activeGrants({ listGrants, revokeGrant }, none, NOW)
    expect(revokeGrant).toHaveBeenCalledTimes(1)
    expect(revokeGrant).toHaveBeenCalledWith({ clientId: B })
    expect(out?.map((g) => [g.grant.client.id, g.expired])).toEqual([[A, false]])
  })

  it('承認が古くても、最近使った許可は取り消さない。使った時刻と期限を返す', async () => {
    const revokeGrant = vi.fn().mockResolvedValue({ data: {}, error: null })
    const listGrants = vi.fn().mockResolvedValue({
      data: [grant(A, ago(200)), grant(B, ago(200)), grant(C, ago(30))], error: null,
    })
    // A は 3 日前に使った・B は 100 日前に使ったきり・C は記録なし (承認から数える)
    const lastUsed = new Map([[A, ago(3)], [B, ago(100)]])
    const out = await activeGrants({ listGrants, revokeGrant }, lastUsed, NOW)
    expect(revokeGrant).toHaveBeenCalledTimes(1)
    expect(revokeGrant).toHaveBeenCalledWith({ clientId: B })
    expect(out?.map((g) => [g.grant.client.id, g.expired, g.lastUsedAt, g.expiresAt?.toISOString()])).toEqual([
      [A, false, ago(3), new Date(NOW.getTime() + (GRANT_MAX_AGE_DAYS - 3) * DAY).toISOString()],
      [C, false, null, new Date(NOW.getTime() + (GRANT_MAX_AGE_DAYS - 30) * DAY).toISOString()],
    ])
  })

  it('取り消しに失敗した許可は期限切れの印を付けて残す (同意の画面はこれを見て止める)', async () => {
    const revokeGrant = vi.fn().mockResolvedValue({ data: null, error: new Error('x') })
    const listGrants = vi.fn().mockResolvedValue({ data: [grant(B, ago(200))], error: null })
    const out = await activeGrants({ listGrants, revokeGrant }, none, NOW)
    expect(out?.map((g) => [g.grant.client.id, g.expired])).toEqual([[B, true]])
  })

  it('一覧を読めなければ null', async () => {
    const out = await activeGrants({
      listGrants: vi.fn().mockResolvedValue({ data: null, error: new Error('disabled') }),
      revokeGrant: vi.fn(),
    }, none, NOW)
    expect(out).toBeNull()
  })
})

describe('readLastUsed', () => {
  const U = '7e500000-0000-0000-0000-000000000901'
  const A = '11111111-1111-4111-8111-111111111111'
  const db = (result: { data: unknown; error: unknown }) => {
    const eq = vi.fn().mockResolvedValue(result)
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    return { from, select, eq }
  }

  it('本人の行をクライアント ID → 最後に使った時刻にする', async () => {
    const d = db({ data: [{ client_id: A, last_used_at: '2026-10-29T00:00:00+00:00' }], error: null })
    const out = await readLastUsed(d as never, U)
    expect(d.from).toHaveBeenCalledWith('oauth_client_last_used')
    expect(d.eq).toHaveBeenCalledWith('user_id', U)
    expect([...(out ?? new Map())]).toEqual([[A, '2026-10-29T00:00:00+00:00']])
  })

  it('読めなければ null (取り消しへ進まない)', async () => {
    expect(await readLastUsed(db({ data: null, error: new Error('x') }) as never, U)).toBeNull()
  })

  it('表がまだ無い (migration の前) ときだけは空にして、承認から数える', async () => {
    for (const code of ['PGRST205', '42P01']) {
      const out = await readLastUsed(db({ data: null, error: { code, message: 'missing' } }) as never, U)
      expect(out?.size).toBe(0)
    }
    expect(await readLastUsed(db({ data: null, error: { code: '42501', message: 'denied' } }) as never, U)).toBeNull()
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
