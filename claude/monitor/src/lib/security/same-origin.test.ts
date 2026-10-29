import { describe, expect, it } from 'vitest'
import { isSameOriginJson } from './same-origin'

function req(h: Record<string, string>): Request {
  return new Request('https://gvms-cloud.com/api/auth/login', { method: 'POST', headers: h })
}

describe('isSameOriginJson (ログインの CSRF)', () => {
  const json = { 'content-type': 'application/json', host: 'gvms-cloud.com' }
  it('同じサイトの画面からの JSON は通す', () => {
    expect(isSameOriginJson(req({ ...json, 'sec-fetch-site': 'same-origin' }))).toBe(true)
    expect(isSameOriginJson(req({ ...json, origin: 'https://gvms-cloud.com' }))).toBe(true)
  })
  it('別のサイトからは断る', () => {
    expect(isSameOriginJson(req({ ...json, 'sec-fetch-site': 'cross-site' }))).toBe(false)
    expect(isSameOriginJson(req({ ...json, 'sec-fetch-site': 'same-site' }))).toBe(false)
    expect(isSameOriginJson(req({ ...json, origin: 'https://evil.example' }))).toBe(false)
  })
  it('フォームの text/plain は断る (JSON に見える本文でも)', () => {
    expect(isSameOriginJson(req({ 'content-type': 'text/plain', host: 'gvms-cloud.com', 'sec-fetch-site': 'same-origin' }))).toBe(false)
  })
  it('ブラウザ以外 (見出しが無い) は通す', () => {
    expect(isSameOriginJson(req(json))).toBe(true)
  })
})
