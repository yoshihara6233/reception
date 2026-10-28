import { describe, it, expect } from 'vitest'
import { jwtAal, hasVerifiedFactor, mfaPending } from './mfa'

/** 署名の無い試験用の JWT（ペイロードだけ意味がある）。 */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`
}

describe('jwtAal', () => {
  it('aal を読む', () => {
    expect(jwtAal(jwt({ aal: 'aal2' }))).toBe('aal2')
    expect(jwtAal(jwt({ aal: 'aal1' }))).toBe('aal1')
  })
  it('読めないものは null', () => {
    expect(jwtAal('tok-1')).toBeNull()
    expect(jwtAal(jwt({}))).toBeNull()
  })
})

describe('mfaPending（番号の確認が済んでいないか）', () => {
  const withFactor = { factors: [{ status: 'verified' }] }
  const unverifiedOnly = { factors: [{ status: 'unverified' }] }
  it('多要素を登録していて aal1 なら止める', () => {
    expect(mfaPending(withFactor, jwt({ aal: 'aal1' }))).toBe(true)
  })
  it('aal2 なら通す', () => {
    expect(mfaPending(withFactor, jwt({ aal: 'aal2' }))).toBe(false)
  })
  it('登録していない人（登録の途中を含む）は止めない', () => {
    expect(mfaPending({ factors: [] }, jwt({ aal: 'aal1' }))).toBe(false)
    expect(mfaPending(unverifiedOnly, jwt({ aal: 'aal1' }))).toBe(false)
    expect(hasVerifiedFactor(null)).toBe(false)
  })
  it('未ログイン・トークン無しは止めない（各ページがログインへ送る）', () => {
    expect(mfaPending(null, jwt({ aal: 'aal1' }))).toBe(false)
    expect(mfaPending(withFactor, null)).toBe(false)
  })
})
