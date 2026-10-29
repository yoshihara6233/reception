import { describe, expect, it } from 'vitest'
import { webhookUrlProblem } from './webhook-url'

describe('発報の Webhook の宛先 (ASVS 12.3.1・13.2.4)', () => {
  it('https の公の宛先は通す・空は使わない扱いで通す', () => {
    for (const ok of ['https://hooks.slack.com/services/T/B/x', 'https://example.co.jp/hook?a=1', '', null]) {
      expect(webhookUrlProblem(ok), String(ok)).toBeNull()
    }
  })
  it('http・資格情報入り・内部の住所・形の崩れは断る', () => {
    for (const ng of ['http://example.com/hook', 'https://u:p@example.com/', 'https://127.0.0.1/', 'https://10.0.0.5/',
      'https://169.254.169.254/latest', 'https://192.168.0.1/', 'https://[::1]/', 'https://localhost/',
      'https://metadata.google.internal/', 'https://nas.local/', 'https://intranet/', 'not a url',
      `https://example.com/${'x'.repeat(2000)}`]) {
      expect(webhookUrlProblem(ng), ng.slice(0, 40)).not.toBeNull()
    }
  })
})
