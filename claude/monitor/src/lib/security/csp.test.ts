import { describe, expect, it } from 'vitest'
import { BASE_CSP_DIRECTIVES, makeNonce, pageCsp } from './csp'

describe('画面の CSP (ASVS 3.4.3)', () => {
  it('nonce は要求ごとに違い、128 bit ある', () => {
    const a = makeNonce(), b = makeNonce()
    expect(a).not.toBe(b)
    expect(atob(a)).toHaveLength(16)
  })
  it('本番は nonce と strict-dynamic の script-src・eval は許さない', () => {
    const csp = pageCsp('abc', false)
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'")
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).toContain("worker-src 'self' blob:")
    for (const d of BASE_CSP_DIRECTIVES) expect(csp).toContain(d)
  })
  it('塞ぎすぎない: frame-src・style-src・default-src を書かない', () => {
    const csp = pageCsp('abc', false)
    expect(csp).not.toContain('frame-src')
    expect(csp).not.toContain('style-src')
    expect(csp).not.toContain('default-src')
  })
  it('開発では React の eval を許す', () => {
    expect(pageCsp('abc', true)).toContain("'unsafe-eval'")
  })
})
