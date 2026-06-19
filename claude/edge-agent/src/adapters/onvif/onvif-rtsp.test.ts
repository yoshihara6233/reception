import { describe, it, expect, vi } from 'vitest'
import { resolveOnvifRtspUrl } from './onvif-rtsp'
import type { OnvifSoapClient } from './onvif-soap-client'

const opts = { endpoint: 'http://192.168.0.101', username: 'admin', password: 'pw' }

describe('resolveOnvifRtspUrl', () => {
  it('channel に対応する profile の RTSP URL を返す', async () => {
    const client = {
      getProfiles: vi.fn().mockResolvedValue([
        { token: 'def_profile1', name: 'Main' },
        { token: 'def_profile2', name: 'Sub' },
      ]),
      getStreamUri: vi.fn().mockResolvedValue('rtsp://192.168.0.101/ONVIF/MediaInput?profile=def_profile2'),
    } as unknown as OnvifSoapClient

    const url = await resolveOnvifRtspUrl(opts, 2, client)
    expect(url).toBe('rtsp://192.168.0.101/ONVIF/MediaInput?profile=def_profile2')
    expect((client.getStreamUri as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('def_profile2', 'RTSP')
  })

  it('範囲外 channel は先頭 profile にフォールバック', async () => {
    const client = {
      getProfiles: vi.fn().mockResolvedValue([{ token: 'p1', name: 'Main' }]),
      getStreamUri: vi.fn().mockResolvedValue('rtsp://x/p1'),
    } as unknown as OnvifSoapClient
    await resolveOnvifRtspUrl(opts, 5, client)
    expect((client.getStreamUri as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('p1', 'RTSP')
  })

  it('profile が無ければ throw', async () => {
    const client = {
      getProfiles: vi.fn().mockResolvedValue([]),
      getStreamUri: vi.fn(),
    } as unknown as OnvifSoapClient
    await expect(resolveOnvifRtspUrl(opts, 1, client)).rejects.toThrow(/no media profiles/)
  })
})
