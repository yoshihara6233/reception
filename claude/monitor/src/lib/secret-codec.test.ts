import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { encryptSecret, decryptSecret } from '@intereco/shared'

const KEY = Buffer.alloc(32, 7).toString('base64')   // 32-byte test key (base64)

describe('secret-codec (Vault化 AES-256-GCM)', () => {
  beforeEach(() => { delete process.env.SECRETS_ENC_KEY })
  afterEach(() => { delete process.env.SECRETS_ENC_KEY })

  it('round-trips with a key (enc:v1 format, ciphertext hides plaintext)', () => {
    process.env.SECRETS_ENC_KEY = KEY
    const enc = encryptSecret('s3cr3t-pw')
    expect(enc.startsWith('enc:v1:')).toBe(true)
    expect(enc).not.toContain('s3cr3t-pw')
    expect(decryptSecret(enc)).toBe('s3cr3t-pw')
  })

  it('produces distinct ciphertexts for the same input (random IV)', () => {
    process.env.SECRETS_ENC_KEY = KEY
    expect(encryptSecret('a')).not.toBe(encryptSecret('a'))
  })

  it('falls back to plain: when no key is configured (safe pre-key rollout)', () => {
    expect(encryptSecret('pw')).toBe('plain:pw')
  })

  it('reads legacy plain: and raw values', () => {
    expect(decryptSecret('plain:abc')).toBe('abc')
    expect(decryptSecret('rawvalue')).toBe('rawvalue')
  })

  it('throws when decrypting enc:v1 without the key', () => {
    process.env.SECRETS_ENC_KEY = KEY
    const enc = encryptSecret('x')
    delete process.env.SECRETS_ENC_KEY
    expect(() => decryptSecret(enc)).toThrow()
  })

  it('accepts a 64-hex key and round-trips', () => {
    process.env.SECRETS_ENC_KEY = '00'.repeat(32)   // 64 hex chars = 32 bytes
    const enc = encryptSecret('hello')
    expect(decryptSecret(enc)).toBe('hello')
  })

  it('rejects a wrong-size key', () => {
    process.env.SECRETS_ENC_KEY = Buffer.alloc(16, 1).toString('base64')   // 16 bytes
    expect(() => encryptSecret('x')).toThrow()
  })
})
