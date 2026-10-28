import { describe, expect, it } from 'vitest'
import { isForeignClientToken, jwtClientId } from './foreign-client'

function jwt(claims: object): string {
  const b = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b({ alg: 'ES256' })}.${b(claims)}.sig`
}

describe('拠点向けのトークンの見分け', () => {
  it('client_id があれば拠点向け', () => {
    expect(jwtClientId(jwt({ sub: 'u', client_id: 'site-1' }))).toBe('site-1')
    expect(isForeignClientToken(jwt({ sub: 'u', client_id: 'site-1' }))).toBe(true)
  })
  it('クラウド自身のログインのトークン (client_id なし・空) は通す', () => {
    expect(isForeignClientToken(jwt({ sub: 'u', aal: 'aal2' }))).toBe(false)
    expect(isForeignClientToken(jwt({ sub: 'u', client_id: '' }))).toBe(false)
  })
  it('読めないトークン・null は拠点向けとみなさない (getUser が先に断る)', () => {
    expect(isForeignClientToken('not-a-jwt')).toBe(false)
    expect(isForeignClientToken(null)).toBe(false)
  })
})
