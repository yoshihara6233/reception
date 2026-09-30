import { describe, it, expect } from 'vitest'
import { isAllowedResetHost, resetLinkOrigin, RESET_FALLBACK_ORIGIN } from './reset-host'

describe('isAllowedResetHost (パスワード再設定のリンクを向けてよいホスト)', () => {
  it('本番の専用ドメイン (apex とサブドメイン)', () => {
    expect(isAllowedResetHost('gvms-cloud.com')).toBe(true)
    expect(isAllowedResetHost('www.gvms-cloud.com')).toBe(true)
    expect(isAllowedResetHost('GVMS-Cloud.com')).toBe(true)
  })
  it('会社ドメイン・Vercel・ローカル開発', () => {
    expect(isAllowedResetHost('cloud.genesis-edge.com')).toBe(true)
    expect(isAllowedResetHost('intereco-monitor.vercel.app')).toBe(true)
    expect(isAllowedResetHost('localhost')).toBe(true)
    expect(isAllowedResetHost('127.0.0.1')).toBe(true)
  })
  it('似せた他所のドメインは許さない (トークンの持ち出し)', () => {
    expect(isAllowedResetHost('evilgvms-cloud.com')).toBe(false)
    expect(isAllowedResetHost('gvms-cloud.com.attacker.example')).toBe(false)
    expect(isAllowedResetHost('genesis-edge.com.attacker.example')).toBe(false)
    expect(isAllowedResetHost('attacker.example')).toBe(false)
    expect(isAllowedResetHost('')).toBe(false)
  })
})

describe('resetLinkOrigin', () => {
  it('許すホストはそのまま (ポートも保つ)', () => {
    expect(resetLinkOrigin('gvms-cloud.com', 'https')).toBe('https://gvms-cloud.com')
    expect(resetLinkOrigin('localhost:3000', 'http')).toBe('http://localhost:3000')
  })
  it('許さないホストは既定の本番 URL に倒す', () => {
    expect(resetLinkOrigin('attacker.example', 'https')).toBe(RESET_FALLBACK_ORIGIN)
  })
  it('proto は http か https だけ (それ以外は https)', () => {
    expect(resetLinkOrigin('gvms-cloud.com', 'javascript')).toBe('https://gvms-cloud.com')
    expect(resetLinkOrigin('gvms-cloud.com', null)).toBe('https://gvms-cloud.com')
  })
})
