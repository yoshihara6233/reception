import { describe, it, expect } from 'vitest'
import { buildOnvifEndpoint } from './onvif-endpoint'

describe('buildOnvifEndpoint', () => {
  it('uses port 80 when onvif_port is null', () => {
    expect(buildOnvifEndpoint('192.168.0.10', null)).toBe('http://192.168.0.10:80')
  })
  it('uses the given onvif port', () => {
    expect(buildOnvifEndpoint('192.168.0.10', 8000)).toBe('http://192.168.0.10:8000')
  })
})
