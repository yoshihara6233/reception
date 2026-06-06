/**
 * F55.A: Axis VAPIX adapter テスト (fetch mock)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NvrAdapterConfig, FirmwareInfo, NvrCapabilities } from '@intereco/shared'
import { CONSERVATIVE_CAPABILITIES } from '@intereco/shared'
import { AxisAdapter, createAxisAdapter } from './axis-adapter'
import { VapixClient } from './vapix-client'

function mockFetchOnce(body: Uint8Array | string, status = 200, headers: Record<string, string> = {}): void {
  const buf = typeof body === 'string' ? new TextEncoder().encode(body) : body
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(buf, { status, headers }),
  )
}

function makeConfig(): NvrAdapterConfig {
  return {
    storeId:     'st-1',
    vendor:      'axis-vapix',
    endpoint:    'http://10.0.2.5',
    credentials: { username: 'root', password: 'pass' },
    options:     {},
    timeoutMs:   5000,
    retryCount:  0,
  }
}

const FW: FirmwareInfo = {
  vendor: 'axis', modelFamily: 'p3_series', modelNumber: 'P3245-LV',
  fwVersion: '10.12.0', fwMajor: 10, fwMinor: 12, fwPatch: 0,
  detectedAt: new Date(), source: 'cgi',
}

const CAPS: NvrCapabilities = {
  ...CONSERVATIVE_CAPABILITIES,
  supportsSnapshot: true, supportsLiveRtsp: true,
  maxChannels: 1, maxResolution: '4K', supportedCodecs: ['h264', 'h265'],
  protocol: ['cgi', 'onvif'],
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

describe('AxisAdapter', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('testConnection: param.cgi が Brand を含めば true', async () => {
    mockFetchOnce('root.Brand.Brand=AXIS\nroot.Brand.ProdNbr=P3245-LV', 200)
    const a = new AxisAdapter(makeConfig(), FW, CAPS)
    expect(await a.testConnection()).toBe(true)
  })

  it('testConnection: family unknown なら false', async () => {
    const a = new AxisAdapter(makeConfig(), { ...FW, modelFamily: 'unknown' }, CAPS)
    expect(await a.testConnection()).toBe(false)
  })

  it('getSnapshot: JPEG body を返す', async () => {
    mockFetchOnce(JPEG, 200, { 'content-type': 'image/jpeg' })
    const a = new AxisAdapter(makeConfig(), FW, CAPS)
    const buf = await a.getSnapshot(1)
    expect(buf[0]).toBe(0xff); expect(buf[1]).toBe(0xd8)

    const spy = vi.mocked(globalThis.fetch)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('/axis-cgi/jpg/image.cgi'),
      expect.anything(),
    )
  })

  it('getSnapshot: JPEG SOI が無ければ protocol_error', async () => {
    mockFetchOnce(new Uint8Array([0x00, 0x00]), 200)
    const a = new AxisAdapter(makeConfig(), FW, CAPS)
    await expect(a.getSnapshot(1)).rejects.toThrow(/not a JPEG/)
  })

  it('getSnapshot: 範囲外チャンネルでエラー', async () => {
    const a = new AxisAdapter(makeConfig(), FW, CAPS)
    await expect(a.getSnapshot(99)).rejects.toThrow(/channel 99 out of range/)
  })

  it('getLiveRtspUri: main stream は h264', async () => {
    const a = new AxisAdapter(makeConfig(), FW, CAPS)
    const uri = await a.getLiveRtspUri(1, 'main')
    expect(uri).toContain('rtsp://root:pass@10.0.2.5:554/axis-media/media.amp')
    expect(uri).toContain('camera=1')
    expect(uri).toContain('videocodec=h264')
    expect(uri).not.toContain('resolution=')
  })

  it('getLiveRtspUri: sub stream は resolution 指定', async () => {
    const a = new AxisAdapter(makeConfig(), FW, CAPS)
    const uri = await a.getLiveRtspUri(1, 'sub')
    expect(uri).toContain('resolution=640x360')
  })

  it('getChannelList: maxChannels 個生成', async () => {
    const a = new AxisAdapter(makeConfig(), FW, { ...CAPS, maxChannels: 4 })
    const list = await a.getChannelList()
    expect(list).toHaveLength(4)
    expect(list[0]).toEqual({ index: 1, name: 'Channel 1', enabled: true })
  })

  it('VapixClient を DI で差し替え可能', async () => {
    const mockClient = {
      get: vi.fn().mockResolvedValue({
        status: 200, body: Buffer.alloc(0),
        text: 'root.Brand.Brand=AXIS', headers: {},
      }),
    } as unknown as VapixClient
    const a = new AxisAdapter(makeConfig(), FW, CAPS, mockClient)
    await a.testConnection()
    expect((mockClient.get as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      '/axis-cgi/param.cgi',
      { action: 'list', group: 'root.Brand' },
    )
  })

  it('createAxisAdapter: FW 取得失敗時は unknown family', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const a = await createAxisAdapter(makeConfig())
    expect(a.firmware.modelFamily).toBe('unknown')
  })

  it('createAxisAdapter: P3 model なら p3_series', async () => {
    mockFetchOnce(
      'root.Brand.ProdNbr=P3245-LV\nroot.Properties.Firmware.Version=10.12.0',
      200,
    )
    const a = await createAxisAdapter(makeConfig())
    expect(a.firmware.modelFamily).toBe('p3_series')
    expect(a.firmware.fwMajor).toBe(10)
    expect(a.firmware.fwMinor).toBe(12)
    expect(a.capabilities.maxChannels).toBe(1)
  })

  it('createAxisAdapter: M70 model なら multi-channel', async () => {
    mockFetchOnce(
      'root.Brand.ProdNbr=M7016\nroot.Properties.Firmware.Version=11.0.0',
      200,
    )
    const a = await createAxisAdapter(makeConfig())
    expect(a.firmware.modelFamily).toBe('m70_series')
    expect(a.capabilities.maxChannels).toBe(16)
  })
})
