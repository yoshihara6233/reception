import { describe, expect, it } from 'vitest'
import { onvifWebhookToken, verifyOnvifWebhookToken } from './onvif-token'

const A = '11111111-2222-3333-4444-555555555555'
const B = '99999999-2222-3333-4444-555555555555'

describe('ONVIF の Webhook の店舗ごとの鍵 (ASVS 2.2.3)', () => {
  it('同じ元の鍵と店舗なら同じ鍵になる', () => {
    expect(onvifWebhookToken(A, 'm')).toBe(onvifWebhookToken(A, 'm'))
    expect(onvifWebhookToken(A, 'm')).toMatch(/^ow1\.[A-Za-z0-9_-]{43}$/)
  })
  it('その店舗の鍵だけを受ける (別の店舗の鍵・元の鍵そのものは受けない)', () => {
    const tokA = onvifWebhookToken(A, 'm')!
    expect(verifyOnvifWebhookToken(A, tokA, 'm')).toBe(true)
    expect(verifyOnvifWebhookToken(B, tokA, 'm')).toBe(false)
    expect(verifyOnvifWebhookToken(A, 'm', 'm')).toBe(false)
  })
  it('元の鍵が変われば鍵も変わる', () => {
    expect(verifyOnvifWebhookToken(A, onvifWebhookToken(A, 'm')!, 'm2')).toBe(false)
  })
  it('元の鍵が無ければ作らず、何も受けない (フェイルクローズ)', () => {
    expect(onvifWebhookToken(A, '')).toBeNull()
    expect(verifyOnvifWebhookToken(A, 'anything', '')).toBe(false)
    expect(verifyOnvifWebhookToken(A, '', 'm')).toBe(false)
  })
})
