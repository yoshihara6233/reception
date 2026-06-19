/**
 * OnvifSoapClient 単体テスト
 *
 * 2026-06-19 実機スパイクで判明したギャップへの対応を検証:
 *   - Media サービス URL の発見 (GetCapabilities) と /onvif/media_service フォールバック
 *   - WS-Security の clock skew 補正 (GetSystemDateAndTime → Created にオフセット反映)
 *   - HTTP Digest ヘルパ
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  OnvifSoapClient, parseDigestChallenge, buildHttpDigest,
} from './onvif-soap-client'

function soapOk(body: string): Response {
  return new Response(
    `<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>${body}</s:Body></s:Envelope>`,
    { status: 200 },
  )
}

const client = () => new OnvifSoapClient({
  endpoint: 'http://10.0.1.20', username: 'admin', password: 'pass', timeoutMs: 2000,
})

afterEach(() => vi.restoreAllMocks())

describe('OnvifSoapClient: Media URL 解決', () => {
  it('GetCapabilities の Media XAddr を使う', async () => {
    const calls: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      calls.push(String(url))
      // 1: GetSystemDateAndTime(time sync) / 2: GetCapabilities / 3: GetProfiles
      if (calls.length === 2) {
        return soapOk('<tds:GetCapabilitiesResponse><tt:Media><tt:XAddr>http://10.0.1.20/onvif/media_service</tt:XAddr></tt:Media></tds:GetCapabilitiesResponse>')
      }
      if (String(url).includes('/onvif/media_service')) {
        return soapOk('<trt:Profiles token="p1"><tt:Name>Main</tt:Name></trt:Profiles>')
      }
      return soapOk('<tds:GetSystemDateAndTimeResponse/>')
    })
    const profiles = await client().getProfiles()
    expect(profiles).toEqual([{ token: 'p1', name: 'Main' }])
    expect(calls.some((u) => u.includes('/onvif/media_service'))).toBe(true)
    // 旧実装の /onvif/Media は使わない
    expect(calls.some((u) => /\/onvif\/Media$/.test(u))).toBe(false)
  })

  it('GetCapabilities 失敗時は /onvif/media_service にフォールバック', async () => {
    let mediaHit = false
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = String(url)
      if (u.includes('/onvif/media_service')) {
        mediaHit = true
        return soapOk('<trt:Profiles token="pA"><tt:Name>A</tt:Name></trt:Profiles>')
      }
      // device_service への呼び出し (time sync / GetCapabilities) は全て失敗扱い
      return new Response('err', { status: 500 })
    })
    const profiles = await client().getProfiles()
    expect(mediaHit).toBe(true)
    expect(profiles[0].token).toBe('pA')
  })
})

describe('OnvifSoapClient: clock skew 補正', () => {
  it('機器時刻のオフセットが WS-Security の Created に反映される', async () => {
    // 機器は端末より 1 時間進んでいる
    const deviceTime = new Date(Date.now() + 3_600_000)
    const iso = deviceTime
    const bodies: string[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      bodies.push(String((init as RequestInit)?.body ?? ''))
      const u = String(url)
      if (bodies.length === 1) {
        // GetSystemDateAndTime
        return soapOk(
          `<tds:GetSystemDateAndTimeResponse><tt:SystemDateAndTime><tt:UTCDateTime>` +
          `<tt:Time><tt:Hour>${iso.getUTCHours()}</tt:Hour><tt:Minute>${iso.getUTCMinutes()}</tt:Minute><tt:Second>${iso.getUTCSeconds()}</tt:Second></tt:Time>` +
          `<tt:Date><tt:Year>${iso.getUTCFullYear()}</tt:Year><tt:Month>${iso.getUTCMonth() + 1}</tt:Month><tt:Day>${iso.getUTCDate()}</tt:Day></tt:Date>` +
          `</tt:UTCDateTime></tt:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>`,
        )
      }
      if (u.includes('device_service')) {
        return soapOk('<tds:GetDeviceInformationResponse><tds:Manufacturer>i-PRO</tds:Manufacturer><tds:Model>WV-X</tds:Model><tds:FirmwareVersion>2.0</tds:FirmwareVersion></tds:GetDeviceInformationResponse>')
      }
      return soapOk('')
    })
    await client().getDeviceInformation()
    // 2 回目 (GetDeviceInformation) の Created が ~1時間先になっている
    const createdMatch = bodies[1].match(/<wsu:Created[^>]*>([^<]+)<\/wsu:Created>/)
    expect(createdMatch).toBeTruthy()
    const created = new Date(createdMatch![1]).getTime()
    const skew = created - Date.now()
    expect(skew).toBeGreaterThan(3_000_000) // ~1時間 ≒ 3.6M ms (誤差許容)
  })
})

describe('HTTP Digest ヘルパ', () => {
  it('parseDigestChallenge: realm/nonce/qop を抽出', () => {
    const ch = parseDigestChallenge('Digest realm="cam", nonce="abc123", qop="auth", algorithm=MD5')
    expect(ch.realm).toBe('cam')
    expect(ch.nonce).toBe('abc123')
    expect(ch.qop).toBe('auth')
    expect(ch.algorithm).toBe('MD5')
  })

  it('buildHttpDigest: 必須フィールドを含む Authorization を生成', () => {
    const h = buildHttpDigest('GET', 'http://10.0.1.20/snap.jpg?ch=1', 'admin', 'pass', {
      realm: 'cam', nonce: 'abc123', qop: 'auth',
    })
    expect(h).toMatch(/^Digest /)
    expect(h).toContain('username="admin"')
    expect(h).toContain('uri="/snap.jpg?ch=1"')
    expect(h).toContain('qop=auth')
    expect(h).toMatch(/response="[0-9a-f]{32}"/)
  })
})
