import { describe, expect, it } from 'vitest'
import { isCrossSiteWrite } from './fetch-metadata'

function req(method: string, h: Record<string, string>): Request {
  return new Request('https://gvms-cloud.com/api/admin/stores', { method, headers: { host: 'gvms-cloud.com', ...h } })
}

describe('isCrossSiteWrite (どの受け口でも CSRF を断る)', () => {
  it('別のサイトからの書き込みは断る', () => {
    expect(isCrossSiteWrite(req('POST', { 'sec-fetch-site': 'cross-site' }))).toBe(true)
    expect(isCrossSiteWrite(req('DELETE', { 'sec-fetch-site': 'same-site' }))).toBe(true)
    expect(isCrossSiteWrite(req('PUT', { origin: 'https://evil.example' }))).toBe(true)
    expect(isCrossSiteWrite(req('POST', { origin: 'null' }))).toBe(true)
  })
  it('同じサイトの画面からの書き込みは通す', () => {
    expect(isCrossSiteWrite(req('POST', { 'sec-fetch-site': 'same-origin' }))).toBe(false)
    expect(isCrossSiteWrite(req('PATCH', { origin: 'https://gvms-cloud.com' }))).toBe(false)
  })
  it('読み取りとブラウザ以外 (見出しが無い) は対象にしない', () => {
    expect(isCrossSiteWrite(req('GET', { 'sec-fetch-site': 'cross-site' }))).toBe(false)
    expect(isCrossSiteWrite(req('POST', {}))).toBe(false)
  })
})
