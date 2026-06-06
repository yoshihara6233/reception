/**
 * F52.B: Hikvision adapter テスト (fetch mock)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NvrAdapterConfig, FirmwareInfo, NvrCapabilities } from '@intereco/shared'
import { CONSERVATIVE_CAPABILITIES } from '@intereco/shared'
import { HikvisionAdapter, createHikvisionAdapter } from './hikvision-adapter'
import { IsapiClient } from './isapi-client'

function mockFetchOnce(body: Uint8Array | string, status = 200, headers: Record<string, string> = {}): void {
  const buf = typeof body === 'string' ? new TextEncoder().encode(body) : body
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(buf, { status, headers }),
  )
}

function makeConfig(): NvrAdapterConfig {
  return {
    storeId:     'st-1',
    vendor:      'hikvision',
    endpoint:    'http://10.0.1.5',
    credentials: { username: 'admin', password: 'secret' },
    options:     {},
    timeoutMs:   5000,
    retryCount:  0,
  }
}

const FW: FirmwareInfo = {
  vendor: 'hikvision', modelFamily: 'nvr_pro', modelNumber: 'DS-7616NI-K2/16P',
  fwVersion: 'V4.71.410', fwMajor: 4, fwMinor: 71, fwPatch: 410,
  detectedAt: new Date(), source: 'cgi',
}

const CAPS: NvrCapabilities = {
  ...CONSERVATIVE_CAPABILITIES,
  supportsSnapshot: true, supportsLiveRtsp: true, supportsVod: true,
  maxVodHours: 24,    // F53.A: VOD テストで必要
  maxChannels: 16, maxResolution: '4K', supportedCodecs: ['h264', 'h265'],
  protocol: ['cgi', 'onvif'],
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

describe('HikvisionAdapter', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('testConnection: deviceInfo XML が返れば true', async () => {
    mockFetchOnce('<DeviceInfo><deviceName>DS-7616</deviceName></DeviceInfo>', 200)
    const a = new HikvisionAdapter(makeConfig(), FW, CAPS)
    expect(await a.testConnection()).toBe(true)
  })

  it('testConnection: family unknown なら false', async () => {
    const a = new HikvisionAdapter(makeConfig(), { ...FW, modelFamily: 'unknown' }, CAPS)
    expect(await a.testConnection()).toBe(false)
  })

  it('getSnapshot: JPEG body を返す', async () => {
    mockFetchOnce(JPEG, 200, { 'content-type': 'image/jpeg' })
    const a = new HikvisionAdapter(makeConfig(), FW, CAPS)
    const buf = await a.getSnapshot(3)
    expect(buf[0]).toBe(0xff); expect(buf[1]).toBe(0xd8)

    const spy = vi.mocked(globalThis.fetch)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('/ISAPI/Streaming/channels/301/picture'),
      expect.anything(),
    )
  })

  it('getSnapshot: 範囲外チャンネルでエラー', async () => {
    const a = new HikvisionAdapter(makeConfig(), FW, CAPS)
    await expect(a.getSnapshot(99)).rejects.toThrow(/channel 99 out of range/)
  })

  it('getLiveRtspUri: main stream は /Streaming/Channels/<ch>01', async () => {
    const a = new HikvisionAdapter(makeConfig(), FW, CAPS)
    const uri = await a.getLiveRtspUri(5, 'main')
    expect(uri).toBe('rtsp://admin:secret@10.0.1.5:554/Streaming/Channels/0501')
  })

  it('getLiveRtspUri: sub stream は /Streaming/Channels/<ch>02', async () => {
    const a = new HikvisionAdapter(makeConfig(), FW, CAPS)
    const uri = await a.getLiveRtspUri(5, 'sub')
    expect(uri).toBe('rtsp://admin:secret@10.0.1.5:554/Streaming/Channels/0502')
  })

  it('getChannelList: maxChannels 個生成', async () => {
    const a = new HikvisionAdapter(makeConfig(), FW, { ...CAPS, maxChannels: 8 })
    const list = await a.getChannelList()
    expect(list).toHaveLength(8)
    expect(list[0]).toEqual({ index: 1, name: 'Camera 01', enabled: true })
  })

  it('getVodMp4: 範囲が maxVodHours 超過なら error', async () => {
    const a = new HikvisionAdapter(makeConfig(), FW, { ...CAPS, maxVodHours: 1 })
    const from = new Date('2026-06-04T00:00:00Z')
    const to   = new Date('2026-06-04T03:00:00Z')
    await expect(a.getVodMp4(1, from, to)).rejects.toThrow(/exceeds max/)
  })

  it('getVodMp4: search で何も見つからなければ not_found', async () => {
    mockFetchOnce('<CMSearchResult><numOfMatches>0</numOfMatches></CMSearchResult>', 200)
    const a = new HikvisionAdapter(makeConfig(), FW, CAPS)
    await expect(a.getVodMp4(1, new Date(0), new Date(3600_000)))
      .rejects.toThrow(/no recordings/)
  })

  it('getVodMp4: playbackURI が RTSP なら ffmpeg pipeline で MP4 stream を返す (F55.D)', async () => {
    // F55.D: RTSP playback URL は ffmpeg で MP4 変換される
    // テスト環境では ffmpeg バイナリの有無に依存するため、
    // 関数が「stream を返す」か「ENOENT で reject」のどちらか OK とする
    mockFetchOnce(
      '<CMSearchResult><searchMatchItem><mediaSegmentDescriptor>' +
      '<playbackURI>rtsp://10.0.1.5/Streaming/tracks/101?starttime=x</playbackURI>' +
      '</mediaSegmentDescriptor></searchMatchItem></CMSearchResult>',
      200,
    )
    const a = new HikvisionAdapter(makeConfig(), FW, CAPS)
    try {
      const stream = await a.getVodMp4(1, new Date(0), new Date(3600_000))
      expect(stream).toBeDefined()
      // 即座に掃除
      ;(stream as { destroy?: () => void }).destroy?.()
    } catch (err) {
      expect((err as Error).message).toMatch(/ffmpeg|ENOENT|spawn/i)
    }
  })

  it('getVodMp4: HTTP playbackURI なら download stream を返す', async () => {
    mockFetchOnce(
      '<CMSearchResult><searchMatchItem><mediaSegmentDescriptor>' +
      '<playbackURI>http://10.0.1.5/download/abc.mp4</playbackURI>' +
      '</mediaSegmentDescriptor></searchMatchItem></CMSearchResult>',
      200,
    )
    const downloadStream = new ReadableStream({
      start(c) { c.enqueue(new Uint8Array([0x00, 0x00, 0x00, 0x20])); c.close() },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(downloadStream, { status: 200, headers: { 'content-type': 'video/mp4' } }),
    )
    const a = new HikvisionAdapter(makeConfig(), FW, CAPS)
    const stream = await a.getVodMp4(1, new Date(0), new Date(3600_000))
    expect(stream).toBeDefined()
  })

  it('IsapiClient を DI で差し替え可能', async () => {
    const mockClient = {
      get: vi.fn().mockResolvedValue({ status: 200, body: Buffer.alloc(0), text: '<deviceName>X</deviceName>', headers: {} }),
    } as unknown as IsapiClient
    const a = new HikvisionAdapter(makeConfig(), FW, CAPS, mockClient)
    await a.testConnection()
    expect((mockClient.get as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('/ISAPI/System/deviceInfo')
  })

  it('createHikvisionAdapter: FW 取得失敗時は unknown family', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const a = await createHikvisionAdapter(makeConfig())
    expect(a.firmware.modelFamily).toBe('unknown')
  })

  it('createHikvisionAdapter: AcuSense モデルなら AI capability 追加', async () => {
    // FW 検出 → testConnection の 2 リクエスト分用意 (createHikvisionAdapter は 1 回だけ呼ぶ)
    mockFetchOnce(
      '<DeviceInfo><model>DS-7616NXI-K2/16P</model><firmwareVersion>V5.0.1</firmwareVersion></DeviceInfo>',
      200,
    )
    const a = await createHikvisionAdapter(makeConfig())
    expect(a.firmware.modelFamily).toBe('acusense')
    expect(a.capabilities.supportsAiMetadata).toBe(true)
    expect(a.capabilities.eventTypes).toContain('ai_person')
  })
})
