/**
 * F52.A: ONVIF Generic adapter テスト
 *
 * SOAP レスポンスを mock して、Profile 列挙 → snapshot URI / stream URI 取得
 * の流れを検証。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NvrAdapterConfig, FirmwareInfo, NvrCapabilities } from '@intereco/shared'
import { CONSERVATIVE_CAPABILITIES } from '@intereco/shared'
import { OnvifGenericAdapter, createOnvifGenericAdapter } from './onvif-generic-adapter'
import { OnvifSoapClient } from './onvif-soap-client'

function makeConfig(): NvrAdapterConfig {
  return {
    storeId: 'st-1', vendor: 'onvif-generic',
    endpoint: 'http://10.0.1.20', credentials: { username: 'admin', password: 'pass' },
    options: {}, timeoutMs: 5000, retryCount: 0,
  }
}
const FW: FirmwareInfo = {
  vendor: 'onvif', modelFamily: 'generic', modelNumber: 'OnvifBox-100',
  fwVersion: '1.5.0', fwMajor: 1, fwMinor: 5, fwPatch: 0,
  detectedAt: new Date(), source: 'onvif',
}
const CAPS: NvrCapabilities = {
  ...CONSERVATIVE_CAPABILITIES,
  protocol: ['onvif'], supportsSnapshot: true, supportsLiveRtsp: true,
  maxChannels: 8, maxResolution: '4K', supportedCodecs: ['h264'],
}

describe('OnvifGenericAdapter', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('testConnection: GetDeviceInformation が成功すれば true', async () => {
    const mockClient = {
      getDeviceInformation: vi.fn().mockResolvedValue({
        manufacturer: 'Generic', model: 'OnvifBox-100', firmwareVersion: '1.5.0',
      }),
    } as unknown as OnvifSoapClient
    const a = new OnvifGenericAdapter(makeConfig(), FW, CAPS, mockClient)
    expect(await a.testConnection()).toBe(true)
  })

  it('testConnection: unknown family なら false', async () => {
    const a = new OnvifGenericAdapter(makeConfig(), { ...FW, modelFamily: 'unknown' }, CAPS)
    expect(await a.testConnection()).toBe(false)
  })

  it('getChannelList: profiles から channel リストを生成', async () => {
    const mockClient = {
      getProfiles: vi.fn().mockResolvedValue([
        { token: 'p1', name: 'Main' },
        { token: 'p2', name: 'Sub' },
      ]),
    } as unknown as OnvifSoapClient
    const a = new OnvifGenericAdapter(makeConfig(), FW, CAPS, mockClient)
    const list = await a.getChannelList()
    expect(list).toEqual([
      { index: 1, name: 'Main', enabled: true },
      { index: 2, name: 'Sub',  enabled: true },
    ])
  })

  it('getLiveRtspUri: getStreamUri を呼ぶ', async () => {
    const mockClient = {
      getProfiles:  vi.fn().mockResolvedValue([{ token: 'pX', name: 'X' }]),
      getStreamUri: vi.fn().mockResolvedValue('rtsp://onvif/feed/1'),
    } as unknown as OnvifSoapClient
    const a = new OnvifGenericAdapter(makeConfig(), FW, CAPS, mockClient)
    const uri = await a.getLiveRtspUri(1)
    expect(uri).toBe('rtsp://onvif/feed/1')
    expect((mockClient.getStreamUri as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('pX', 'RTSP')
  })

  it('getSnapshot: GetSnapshotUri + HTTP fetch で JPEG', async () => {
    const mockClient = {
      getProfiles:    vi.fn().mockResolvedValue([{ token: 'pX', name: 'X' }]),
      getSnapshotUri: vi.fn().mockResolvedValue('http://10.0.1.20/snap.jpg'),
    } as unknown as OnvifSoapClient
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), { status: 200 }),
    )
    const a = new OnvifGenericAdapter(makeConfig(), FW, CAPS, mockClient)
    const buf = await a.getSnapshot(1)
    expect(buf[0]).toBe(0xff)
  })

  it('getSnapshot: 401 → AuthError', async () => {
    const mockClient = {
      getProfiles:    vi.fn().mockResolvedValue([{ token: 'pX', name: 'X' }]),
      getSnapshotUri: vi.fn().mockResolvedValue('http://x/snap.jpg'),
    } as unknown as OnvifSoapClient
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('', { status: 401 }),
    )
    const a = new OnvifGenericAdapter(makeConfig(), FW, CAPS, mockClient)
    await expect(a.getSnapshot(1)).rejects.toThrow(/snapshot fetch 401/)
  })

  it('getSnapshot: 範囲外 channel', async () => {
    const a = new OnvifGenericAdapter(makeConfig(), FW, { ...CAPS, maxChannels: 4 })
    await expect(a.getSnapshot(99)).rejects.toThrow(/channel 99 out of range/)
  })

  it('createOnvifGenericAdapter: FW 検出失敗で unknown family', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const a = await createOnvifGenericAdapter(makeConfig())
    expect(a.firmware.modelFamily).toBe('unknown')
  })
})
