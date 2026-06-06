/**
 * F52.D: Hanwha Wisenet adapter テスト
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NvrAdapterConfig, FirmwareInfo, NvrCapabilities } from '@intereco/shared'
import { CONSERVATIVE_CAPABILITIES } from '@intereco/shared'
import { HanwhaAdapter, createHanwhaAdapter } from './hanwha-adapter'

function mockFetchOnce(body: Uint8Array | string, status = 200): void {
  const buf = typeof body === 'string' ? new TextEncoder().encode(body) : body
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(buf, { status }))
}

function makeConfig(): NvrAdapterConfig {
  return {
    storeId: 'st-1', vendor: 'hanwha-wisenet',
    endpoint: 'http://10.0.1.10', credentials: { username: 'admin', password: 'pass' },
    options: {}, timeoutMs: 5000, retryCount: 0,
  }
}

const FW: FirmwareInfo = {
  vendor: 'hanwha-wisenet', modelFamily: 'nvr_pro', modelNumber: 'PRN-1610S2',
  fwVersion: '2.10', fwMajor: 2, fwMinor: 10, fwPatch: 0,
  detectedAt: new Date(), source: 'cgi',
}
const CAPS: NvrCapabilities = {
  ...CONSERVATIVE_CAPABILITIES,
  supportsSnapshot: true, supportsLiveRtsp: true,
  maxChannels: 16, maxResolution: '4K', supportedCodecs: ['h264', 'h265'],
  protocol: ['cgi', 'onvif'],
}
const JPEG = new Uint8Array([0xff, 0xd8, 0xff])

describe('HanwhaAdapter', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('testConnection: deviceinfo 200 で true', async () => {
    mockFetchOnce('<Model>PRN-1610S2</Model>', 200)
    const a = new HanwhaAdapter(makeConfig(), FW, CAPS)
    expect(await a.testConnection()).toBe(true)
  })

  it('getSnapshot: JPEG body 返却', async () => {
    mockFetchOnce(JPEG, 200)
    const a = new HanwhaAdapter(makeConfig(), FW, CAPS)
    const buf = await a.getSnapshot(2)
    expect(buf[0]).toBe(0xff)
    const spy = vi.mocked(globalThis.fetch)
    expect(spy).toHaveBeenCalledWith(
      expect.stringMatching(/stw-cgi\/video\.cgi.*msubmenu=snapshot.*Channel=2/),
      expect.anything(),
    )
  })

  it('getLiveRtspUri: main は profile<N>', async () => {
    const a = new HanwhaAdapter(makeConfig(), FW, CAPS)
    const uri = await a.getLiveRtspUri(3, 'main')
    expect(uri).toBe('rtsp://admin:pass@10.0.1.10:554/profile3/media.smp')
  })

  it('getLiveRtspUri: sub は profile<N+100>', async () => {
    const a = new HanwhaAdapter(makeConfig(), FW, CAPS)
    const uri = await a.getLiveRtspUri(3, 'sub')
    expect(uri).toBe('rtsp://admin:pass@10.0.1.10:554/profile103/media.smp')
  })

  it('getSnapshot: 非 JPEG なら protocol_error', async () => {
    mockFetchOnce(new Uint8Array([0, 0, 0]), 200)
    const a = new HanwhaAdapter(makeConfig(), FW, CAPS)
    await expect(a.getSnapshot(1)).rejects.toThrow(/not a JPEG/)
  })

  it('getChannelList: maxChannels 個生成', async () => {
    const a = new HanwhaAdapter(makeConfig(), FW, { ...CAPS, maxChannels: 4 })
    const list = await a.getChannelList()
    expect(list).toHaveLength(4)
    expect(list[0]).toEqual({ index: 1, name: 'CH01', enabled: true })
  })

  it('createHanwhaAdapter: FW XML 解析', async () => {
    mockFetchOnce(
      '<DeviceInfo><Model>PRN-1610S2</Model><FirmwareVersion>2.10.5</FirmwareVersion></DeviceInfo>',
      200,
    )
    const a = await createHanwhaAdapter(makeConfig())
    expect(a.firmware.modelNumber).toBe('PRN-1610S2')
    expect(a.firmware.fwMajor).toBe(2)
    expect(a.firmware.modelFamily).toBe('nvr_pro')
  })

  it('getVodMp4: maxVodHours 超過なら error', async () => {
    const a = new HanwhaAdapter(makeConfig(), FW, { ...CAPS, supportsVod: true, maxVodHours: 1 })
    await expect(a.getVodMp4(1, new Date(0), new Date(3 * 3600_000)))
      .rejects.toThrow(/exceeds max/)
  })

  it('getVodMp4: 録画なしなら not_found', async () => {
    mockFetchOnce('{"NumberOfItems":0,"ItemList":[]}', 200)
    const a = new HanwhaAdapter(makeConfig(), FW, { ...CAPS, supportsVod: true, maxVodHours: 24 })
    await expect(a.getVodMp4(1, new Date(0), new Date(3600_000)))
      .rejects.toThrow(/no recordings/)
  })

  it('getVodMp4: 録画ありなら download stream を返す', async () => {
    mockFetchOnce('{"NumberOfItems":2,"ItemList":[{}]}', 200)
    const downloadStream = new ReadableStream({
      start(c) { c.enqueue(new Uint8Array([0x00, 0x00, 0x00, 0x20])); c.close() },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(downloadStream, { status: 200, headers: { 'content-type': 'video/mp4' } }),
    )
    const a = new HanwhaAdapter(makeConfig(), FW, { ...CAPS, supportsVod: true, maxVodHours: 24 })
    const stream = await a.getVodMp4(1, new Date(0), new Date(3600_000))
    expect(stream).toBeDefined()
  })

  it('createHanwhaAdapter: FW JSON 解析', async () => {
    mockFetchOnce(
      '{"Model":"PRN-1610S2","FirmwareVersion":"2.10.5","SerialNumber":"X123"}',
      200,
    )
    const a = await createHanwhaAdapter(makeConfig())
    expect(a.firmware.modelNumber).toBe('PRN-1610S2')
    expect(a.firmware.serial).toBe('X123')
  })
})
