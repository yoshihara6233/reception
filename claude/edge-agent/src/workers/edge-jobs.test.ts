import { describe, it, expect } from 'vitest'
import { buildOnvifEndpoint } from './onvif-endpoint'

describe('buildOnvifEndpoint', () => {
  it('uses port 80 when onvif_port is null', () => {
    expect(buildOnvifEndpoint('192.168.0.10', null)).toBe('http://192.168.0.10:80')
  })
  it('uses the given onvif port', () => {
    expect(buildOnvifEndpoint('192.168.0.10', 8000)).toBe('http://192.168.0.10:8000')
  })
  it('★443/8443 は https（常に http だと HTTPS 専用機で探索が失敗する）', () => {
    expect(buildOnvifEndpoint('192.168.0.250', 443)).toBe('https://192.168.0.250:443')
    expect(buildOnvifEndpoint('192.168.0.250', 8443)).toBe('https://192.168.0.250:8443')
  })
  it('URL を直接入れられていればそのまま使う（末尾スラッシュは落とす）', () => {
    expect(buildOnvifEndpoint('https://nvr.example/', 80)).toBe('https://nvr.example')
    expect(buildOnvifEndpoint('http://192.168.0.10:8000', null)).toBe('http://192.168.0.10:8000')
  })
})
