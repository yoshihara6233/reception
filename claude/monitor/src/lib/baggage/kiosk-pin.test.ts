import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import {
  isValidPinFormat, hashPin, verifyPinHash,
  nextLockState, isLocked, MAX_PIN_ATTEMPTS, LOCK_MINUTES,
  signKioskSession, verifyKioskSession,
} from './kiosk-pin'

beforeAll(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-for-hmac'
})

describe('isValidPinFormat', () => {
  it('accepts exactly 6 digits incl. leading zeros', () => {
    expect(isValidPinFormat('000000')).toBe(true)
    expect(isValidPinFormat('123456')).toBe(true)
  })
  it('rejects non-6-digit', () => {
    expect(isValidPinFormat('12345')).toBe(false)
    expect(isValidPinFormat('1234567')).toBe(false)
    expect(isValidPinFormat('12345a')).toBe(false)
    expect(isValidPinFormat('')).toBe(false)
    expect(isValidPinFormat('12 456')).toBe(false)
  })
})

describe('hashPin / verifyPinHash', () => {
  it('roundtrips a correct PIN and rejects wrong ones', () => {
    const h = hashPin('482913')
    expect(verifyPinHash('482913', h)).toBe(true)
    expect(verifyPinHash('482914', h)).toBe(false)
    expect(verifyPinHash('000000', h)).toBe(false)
  })
  it('produces a distinct salt each time (no static hash)', () => {
    expect(hashPin('111111')).not.toBe(hashPin('111111'))
  })
  it('rejects malformed stored hashes', () => {
    expect(verifyPinHash('111111', '')).toBe(false)
    expect(verifyPinHash('111111', 'no-separator')).toBe(false)
  })
})

describe('nextLockState / isLocked', () => {
  const now = new Date('2026-07-20T09:00:00Z')
  it('resets on success', () => {
    expect(nextLockState({ failedAttempts: 3, lockedUntil: null }, true, now))
      .toEqual({ failedAttempts: 0, lockedUntil: null })
  })
  it('increments on failure below the cap', () => {
    expect(nextLockState({ failedAttempts: 1, lockedUntil: null }, false, now))
      .toEqual({ failedAttempts: 2, lockedUntil: null })
  })
  it('locks at the cap and resets the counter', () => {
    const s = nextLockState({ failedAttempts: MAX_PIN_ATTEMPTS - 1, lockedUntil: null }, false, now)
    expect(s.failedAttempts).toBe(0)
    expect(s.lockedUntil?.getTime()).toBe(now.getTime() + LOCK_MINUTES * 60_000)
  })
  it('isLocked reflects the window', () => {
    const until = new Date(now.getTime() + 60_000)
    expect(isLocked(until, now)).toBe(true)
    expect(isLocked(until, new Date(until.getTime() + 1))).toBe(false)
    expect(isLocked(null, now)).toBe(false)
  })
})

describe('signKioskSession / verifyKioskSession', () => {
  const now = new Date('2026-07-20T09:00:00Z')
  const store = '4a9efcec-ab80-4293-9e04-9e355b504855'
  it('verifies a fresh token for its own store', () => {
    const { token } = signKioskSession(store, now)
    expect(verifyKioskSession(token, store, now)).toBe(true)
  })
  it('rejects a token for a different store (no cross-store reuse)', () => {
    const { token } = signKioskSession(store, now)
    expect(verifyKioskSession(token, 'ffffffff-ffff-ffff-ffff-ffffffffffff', now)).toBe(false)
  })
  it('rejects an expired token', () => {
    const { token } = signKioskSession(store, now)
    const later = new Date(now.getTime() + 13 * 3_600_000)
    expect(verifyKioskSession(token, store, later)).toBe(false)
  })
  it('rejects tampered signatures and garbage', () => {
    const { token } = signKioskSession(store, now)
    expect(verifyKioskSession(token.slice(0, -2) + 'xy', store, now)).toBe(false)
    expect(verifyKioskSession('', store, now)).toBe(false)
    expect(verifyKioskSession('abc', store, now)).toBe(false)
  })
})

describe('署名鍵を用途ごとに分ける (ASVS 11.1.2)', () => {
  const now = new Date('2026-10-30T09:00:00Z')
  const store = '4a9efcec-ab80-4293-9e04-9e355b504855'
  const saved = { srk: process.env.SUPABASE_SERVICE_ROLE_KEY, kiosk: process.env.KIOSK_SESSION_SECRET }
  afterEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = saved.srk
    if (saved.kiosk === undefined) delete process.env.KIOSK_SESSION_SECRET
    else process.env.KIOSK_SESSION_SECRET = saved.kiosk
  })

  it('KIOSK_SESSION_SECRET があれば、service_role の鍵を作り直してもセッションは切れない', () => {
    process.env.KIOSK_SESSION_SECRET = 'kiosk-dedicated-secret-0123456789abcdef'
    const { token } = signKioskSession(store, now)
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'rotated-service-role-key'
    expect(verifyKioskSession(token, store, now)).toBe(true)
  })

  it('KIOSK_SESSION_SECRET があれば、service_role の鍵が無くても動く', () => {
    process.env.KIOSK_SESSION_SECRET = 'kiosk-dedicated-secret-0123456789abcdef'
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const { token } = signKioskSession(store, now)
    expect(verifyKioskSession(token, store, now)).toBe(true)
  })

  it('service_role の鍵から作った以前のトークンは、専用の鍵では通らない', () => {
    delete process.env.KIOSK_SESSION_SECRET
    const { token: legacy } = signKioskSession(store, now)
    process.env.KIOSK_SESSION_SECRET = 'kiosk-dedicated-secret-0123456789abcdef'
    expect(verifyKioskSession(legacy, store, now)).toBe(false)
  })

  it('KIOSK_SESSION_SECRET が無ければ以前の作り方で動く (移行の間の逃げ道)', () => {
    delete process.env.KIOSK_SESSION_SECRET
    const { token } = signKioskSession(store, now)
    expect(verifyKioskSession(token, store, now)).toBe(true)
  })

  it('どちらの鍵も無ければ署名しない (例外)', () => {
    delete process.env.KIOSK_SESSION_SECRET
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(() => signKioskSession(store, now)).toThrow()
  })
})
