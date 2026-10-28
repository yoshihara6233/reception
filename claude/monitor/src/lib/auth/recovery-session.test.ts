import { describe, expect, it } from 'vitest'
import { isRecentRecoverySession, RECOVERY_WINDOW_SEC } from './recovery-session'

const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (amr: unknown) => `${b64({ alg: 'ES256' })}.${b64({ sub: 'u', amr })}.sig`
const NOW = 1_800_000_000

describe('再設定のセッションか (ASVS 6.2.3)', () => {
  it('最近の再設定の番号 (recovery・otp) で入ったセッションは通す', () => {
    expect(isRecentRecoverySession(jwt([{ method: 'recovery', timestamp: NOW - 60 }]), NOW)).toBe(true)
    expect(isRecentRecoverySession(jwt([{ method: 'otp', timestamp: NOW - 60 }]), NOW)).toBe(true)
  })
  it('パスワードで入った普通のセッションは通さない', () => {
    expect(isRecentRecoverySession(jwt([{ method: 'password', timestamp: NOW - 60 }]), NOW)).toBe(false)
    expect(isRecentRecoverySession(jwt([{ method: 'password', timestamp: NOW - 60 }, { method: 'totp', timestamp: NOW - 30 }]), NOW)).toBe(false)
  })
  it('番号で入ってから時間が経ったセッションは通さない', () => {
    expect(isRecentRecoverySession(jwt([{ method: 'recovery', timestamp: NOW - RECOVERY_WINDOW_SEC - 1 }]), NOW)).toBe(false)
  })
  it('読めないトークンは通さない', () => {
    for (const t of [null, undefined, '', 'x.y.z', jwt('recovery'), jwt([{ method: 'recovery' }])]) {
      expect(isRecentRecoverySession(t as string, NOW)).toBe(false)
    }
  })
})
