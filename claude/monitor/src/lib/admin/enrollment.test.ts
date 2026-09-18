import { describe, it, expect } from 'vitest'
import {
  generateEnrollToken,
  hashEnrollToken,
  enrollExpiryIso,
  ENROLL_TTL_MS,
  generateShortCode,
  hashShortCode,
} from './enrollment'

describe('enrollment token util', () => {
  it('generates a 64-hex (32-byte) raw token', () => {
    const t = generateEnrollToken()
    expect(t).toMatch(/^[0-9a-f]{64}$/)
  })

  it('generates unique tokens', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateEnrollToken()))
    expect(set.size).toBe(100)
  })

  it('hashes to a stable 64-hex SHA-256 (same input → same hash)', () => {
    const h1 = hashEnrollToken('abc')
    const h2 = hashEnrollToken('abc')
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
    // 既知ベクタ: sha256("abc")
    expect(h1).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('different inputs → different hash', () => {
    expect(hashEnrollToken('a')).not.toBe(hashEnrollToken('b'))
  })

  it('the raw token is NOT recoverable from the hash (one-way)', () => {
    const raw = generateEnrollToken()
    expect(hashEnrollToken(raw)).not.toContain(raw)
  })

  it('expiry is now + 24h', () => {
    const now = 1_000_000_000_000
    const iso = enrollExpiryIso(now)
    expect(new Date(iso).getTime()).toBe(now + ENROLL_TTL_MS)
    expect(ENROLL_TTL_MS).toBe(24 * 60 * 60 * 1000)
  })
})

describe('short code util（nvms 手入力コード）', () => {
  it('曖昧文字を除いた集合・XXXXX-XXXXX 形式', () => {
    const c = generateShortCode()
    expect(c).toMatch(/^[2-9A-HJKMNP-TV-Z]{5}-[2-9A-HJKMNP-TV-Z]{5}$/)
    // 紛らわしい 0/O/1/I/L/U を含まない
    expect(c).not.toMatch(/[01ILOU]/)
  })

  it('十分にユニーク', () => {
    const set = new Set(Array.from({ length: 200 }, () => generateShortCode()))
    expect(set.size).toBe(200)
  })

  it('表記ぶれ（小文字・空白・ハイフン）を正規化して同じハッシュ', () => {
    const base = hashShortCode('A7K3Q-2F9MZ')
    expect(hashShortCode('a7k3q-2f9mz')).toBe(base)
    expect(hashShortCode('A7K3Q2F9MZ')).toBe(base)
    expect(hashShortCode(' a7k3q 2f9mz ')).toBe(base)
    expect(hashShortCode('A7K3Q-2F9MX')).not.toBe(base)
  })

  it('トークンとコードのハッシュ空間は分離（同じ文字列でも衝突しない）', () => {
    // hashEnrollToken(raw) と hashShortCode(raw) は別ドメイン（prefix 付き）。
    expect(hashShortCode('abc')).not.toBe(hashEnrollToken('abc'))
  })
})
