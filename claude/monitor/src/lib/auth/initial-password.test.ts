import { describe, expect, it } from 'vitest'
import {
  CLEARED_INITIAL_PASSWORD, INITIAL_PASSWORD_KEY, INITIAL_PASSWORD_TTL_HOURS,
  generateInitialPassword, initialPasswordMetadata, initialPasswordState,
} from './initial-password'

const now = new Date('2026-10-30T00:00:00Z')

describe('initialPasswordState', () => {
  it('印が無ければ本人のパスワード', () => {
    expect(initialPasswordState(null, now)).toBe('none')
    expect(initialPasswordState({}, now)).toBe('none')
    expect(initialPasswordState({ app_metadata: { provider: 'email' } }, now)).toBe('none')
    expect(initialPasswordState({ app_metadata: { [INITIAL_PASSWORD_KEY]: null } }, now)).toBe('none')
  })
  it('期限の前は pending・過ぎたら expired', () => {
    expect(initialPasswordState({ app_metadata: { [INITIAL_PASSWORD_KEY]: '2026-10-31T00:00:00Z' } }, now)).toBe('pending')
    expect(initialPasswordState({ app_metadata: { [INITIAL_PASSWORD_KEY]: '2026-10-29T00:00:00Z' } }, now)).toBe('expired')
  })
  it('壊れた値は通さない (expired)', () => {
    expect(initialPasswordState({ app_metadata: { [INITIAL_PASSWORD_KEY]: 'x' } }, now)).toBe('expired')
    expect(initialPasswordState({ app_metadata: { [INITIAL_PASSWORD_KEY]: true } }, now)).toBe('expired')
  })
})

describe('initialPasswordMetadata', () => {
  it(`期限は ${INITIAL_PASSWORD_TTL_HOURS} 時間後。作った直後は pending、期限で expired`, () => {
    const meta = initialPasswordMetadata(now)
    expect(meta[INITIAL_PASSWORD_KEY]).toBe('2026-11-02T00:00:00.000Z')
    expect(initialPasswordState({ app_metadata: meta }, now)).toBe('pending')
    expect(initialPasswordState({ app_metadata: meta }, new Date('2026-11-02T00:00:00Z'))).toBe('expired')
  })
  it('外すときはキーを null にする (Supabase Auth は null のキーを消す)', () => {
    expect(CLEARED_INITIAL_PASSWORD).toEqual({ [INITIAL_PASSWORD_KEY]: null })
  })
})

describe('generateInitialPassword', () => {
  it('既定は 16 文字で、見間違えやすい字を含まない', () => {
    for (let i = 0; i < 50; i++) {
      const p = generateInitialPassword()
      expect(p).toHaveLength(16)
      expect(p).not.toMatch(/[0Oo1lI]/)
    }
  })
  it('乱数の値を字へ写す (64 字なので 256 を割り切り、偏りが出ない)', () => {
    const seq = (b: Uint8Array) => { b.forEach((_, i) => { b[i] = i === 0 ? 64 : i }); return b }
    // 64 → 先頭の字 (64 % 64 = 0)、以降 1, 2, 3
    expect(generateInitialPassword(4, seq)).toBe('ABCD')
  })
  it('毎回違う', () => {
    expect(new Set(Array.from({ length: 20 }, () => generateInitialPassword())).size).toBe(20)
  })
})
