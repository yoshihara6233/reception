import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  encryptSecret, decryptSecret, encryptSecretForEdge, edgeSecretKeysFor, setEdgeSecretKeys,
  clearEdgeSecretKeys, needsRewrap,
} from '@intereco/shared'

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

describe('secret-codec enc:v2 (エッジごとの鍵)', () => {
  const E1 = '11111111-1111-4111-8111-111111111111'
  const E2 = '22222222-2222-4222-8222-222222222222'
  const K2 = Buffer.alloc(32, 9).toString('base64')
  const clear = () => {
    delete process.env.SECRETS_ENC_KEY
    delete process.env.SECRETS_ENC_KEYS
    clearEdgeSecretKeys()
  }
  beforeEach(clear)
  afterEach(clear)

  it('writes v1 until SECRETS_ENC_KEYS is set (old edges cannot read v2)', () => {
    process.env.SECRETS_ENC_KEY = KEY
    const enc = encryptSecretForEdge('pw', E1)
    expect(enc.startsWith('enc:v1:')).toBe(true)
    expect(needsRewrap(enc)).toBe(false)
    expect(edgeSecretKeysFor(E1)).not.toBeNull()       // 鍵は先に配り始める
  })

  it('round-trips with the edge id and binds the ciphertext to it (AAD)', () => {
    process.env.SECRETS_ENC_KEYS = `k1:${KEY}`
    const enc = encryptSecretForEdge('pw-e1', E1)
    expect(enc.startsWith('enc:v2:k1:')).toBe(true)
    expect(enc).not.toContain('pw-e1')
    expect(decryptSecret(enc, E1)).toBe('pw-e1')
    expect(() => decryptSecret(enc, E2)).toThrow()   // 別のエッジの行に写しても解けない
    expect(() => decryptSecret(enc)).toThrow()        // エッジの ID 無しでは解かない
  })

  it('edge decrypts with only its derived key (no master on the edge)', () => {
    process.env.SECRETS_ENC_KEYS = `k1:${KEY}`
    const enc = encryptSecretForEdge('pw', E1)
    const keysE1 = edgeSecretKeysFor(E1)!
    const keysE2 = edgeSecretKeysFor(E2)!
    expect(keysE1.k1).not.toBe(keysE2.k1)
    expect(keysE1.k1).not.toBe(KEY)                    // マスタそのものは渡さない
    delete process.env.SECRETS_ENC_KEYS
    setEdgeSecretKeys(E1, keysE1)
    expect(decryptSecret(enc, E1)).toBe('pw')
    setEdgeSecretKeys(E2, keysE2)                      // 別のエッジの鍵では解けない
    expect(() => decryptSecret(enc, E1)).toThrow()
  })

  it('rotates by key id: SECRETS_ENC_KEYS の先頭で書き、古い ID も読める', () => {
    process.env.SECRETS_ENC_KEYS = `k1:${KEY}`
    const old = encryptSecretForEdge('pw', E1)
    process.env.SECRETS_ENC_KEY = KEY
    const v1 = encryptSecret('legacy')
    delete process.env.SECRETS_ENC_KEY
    process.env.SECRETS_ENC_KEYS = `k2:${K2},k1:${KEY}`
    expect(needsRewrap(old)).toBe(true)
    expect(needsRewrap(v1)).toBe(true)
    const fresh = encryptSecretForEdge(decryptSecret(old, E1), E1)
    expect(fresh.startsWith('enc:v2:k2:')).toBe(true)
    expect(needsRewrap(fresh)).toBe(false)
    expect(decryptSecret(fresh, E1)).toBe('pw')
    expect(decryptSecret(v1)).toBe('legacy')            // v1 は k1 (以前の SECRETS_ENC_KEY) で読める
    expect(Object.keys(edgeSecretKeysFor(E1)!)).toEqual(['k2', 'k1'])
  })

  it('falls back to plain: without any master key and never asks to rewrap', () => {
    expect(encryptSecretForEdge('pw', E1)).toBe('plain:pw')
    process.env.SECRETS_ENC_KEYS = ''
    expect(needsRewrap('plain:pw')).toBe(false)
    expect(edgeSecretKeysFor(E1)).toBeNull()
  })

  it('rejects malformed SECRETS_ENC_KEYS', () => {
    process.env.SECRETS_ENC_KEYS = `bad key:${KEY}`
    expect(() => encryptSecretForEdge('x', E1)).toThrow()
  })
})
