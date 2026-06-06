/**
 * F55.B: Dahua adapter テスト (fetch mock)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NvrAdapterConfig, FirmwareInfo, NvrCapabilities } from '@intereco/shared'
import { CONSERVATIVE_CAPABILITIES } from '@intereco/shared'
import { DahuaAdapter, createDahuaAdapter } from './dahua-adapter'
import { DahuaCgiClient } from './dahua-cgi-client'

function mockFetchOnce(body: Uint8Array | string, status = 200, headers: Record<string, string> = {}): void {
  const buf = typeof body === 'string' ? new TextEncoder().encode(body) : body
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(buf, { status, headers }),
  )
}

function makeConfig(): NvrAdapterConfig {
  return {
    storeId:     'st-1',
    vendor:      'dahua',
    endpoint:    'http://10.0.3.5',
    credentials: { username: 'admin', password: 'pass' },
    options:     {},
    timeoutMs:   5000,
    retryCount:  0,
  }
}

const FW: FirmwareInfo = {
  vendor: 'dahua', modelFamily: 'nvr_pro', modelNumber: 'DH-NVR4216-4KS2',
  fwVersion: '4.001.0', fwMajor: 4, fwMinor: 1, fwPatch: 0,
  detectedAt: new Date(), source: 'cgi',
}

const CAPS: NvrCapabilities = {
  ...CONSERVATIVE_CAPABILITIES,
  supportsSnapshot: true, supportsLiveRtsp: true,
  maxChannels: 16, maxResolution: '4K', supportedCodecs: ['h264', 'h265'],
  protocol: ['cgi', 'onvif'],
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

describe('DahuaAdapter', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('testConnection: getDeviceType が type= を含めば true', async () => {
    mockFetchOnce('type=DH-NVR4216-4KS2', 200)
    const a = new DahuaAdapter(makeConfig(), FW, CAPS)
    expect(await a.testConnection()).toBe(true)
  })

  it('testConnection: family unknown なら false', async () => {
    const a = new DahuaAdapter(makeConfig(), { ...FW, modelFamily: 'unknown' }, CAPS)
    expect(await a.testConnection()).toBe(false)
  })

  it('getSnapshot: JPEG body を返す', async () => {
    mockFetchOnce(JPEG, 200, { 'content-type': 'image/jpeg' })
    const a = new DahuaAdapter(makeConfig(), FW, CAPS)
    const buf = await a.getSnapshot(2)
    expect(buf[0]).toBe(0xff); expect(buf[1]).toBe(0xd8)

    const spy = vi.mocked(globalThis.fetch)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('/cgi-bin/snapshot.cgi'),
      expect.anything(),
    )
  })

  it('getSnapshot: JPEG SOI が無ければ protocol_error', async () => {
    mockFetchOnce(new Uint8Array([0x00, 0x00]), 200)
    const a = new DahuaAdapter(makeConfig(), FW, CAPS)
    await expect(a.getSnapshot(1)).rejects.toThrow(/not a JPEG/)
  })

  it('getSnapshot: 範囲外チャンネルでエラー', async () => {
    const a = new DahuaAdapter(makeConfig(), FW, CAPS)
    await expect(a.getSnapshot(99)).rejects.toThrow(/channel 99 out of range/)
  })

  it('getLiveRtspUri: main stream は subtype=0', async () => {
    const a = new DahuaAdapter(makeConfig(), FW, CAPS)
    const uri = await a.getLiveRtspUri(5, 'main')
    expect(uri).toBe(
      'rtsp://admin:pass@10.0.3.5:554/cam/realmonitor?channel=5&subtype=0',
    )
  })

  it('getLiveRtspUri: sub stream は subtype=1', async () => {
    const a = new DahuaAdapter(makeConfig(), FW, CAPS)
    const uri = await a.getLiveRtspUri(5, 'sub')
    expect(uri).toBe(
      'rtsp://admin:pass@10.0.3.5:554/cam/realmonitor?channel=5&subtype=1',
    )
  })

  it('getChannelList: maxChannels 個生成', async () => {
    const a = new DahuaAdapter(makeConfig(), FW, { ...CAPS, maxChannels: 8 })
    const list = await a.getChannelList()
    expect(list).toHaveLength(8)
    expect(list[0]).toEqual({ index: 1, name: 'Channel 1', enabled: true })
  })

  it('DahuaCgiClient を DI で差し替え可能', async () => {
    const mockClient = {
      get: vi.fn().mockResolvedValue({
        status: 200, body: Buffer.alloc(0),
        text: 'type=DH-NVR4216-4KS2', headers: {},
      }),
    } as unknown as DahuaCgiClient
    const a = new DahuaAdapter(makeConfig(), FW, CAPS, mockClient)
    await a.testConnection()
    expect((mockClient.get as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      '/cgi-bin/magicBox.cgi',
      { action: 'getDeviceType' },
    )
  })

  it('createDahuaAdapter: FW 取得失敗時は unknown family', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const a = await createDahuaAdapter(makeConfig())
    expect(a.firmware.modelFamily).toBe('unknown')
  })

  it('createDahuaAdapter: NVR model なら supportsVod=true & maxChannels=16', async () => {
    mockFetchOnce('type=DH-NVR4216-4KS2', 200)
    mockFetchOnce('version=V4.001.0000000.1.R', 200)
    const a = await createDahuaAdapter(makeConfig())
    expect(a.firmware.modelFamily).toBe('nvr_pro')
    expect(a.capabilities.supportsVod).toBe(true)
    expect(a.capabilities.maxChannels).toBe(16)
  })

  it('createDahuaAdapter: AcuPick model なら AI capability 追加', async () => {
    mockFetchOnce('type=DH-NVR5216-AI-4KS3', 200)
    mockFetchOnce('version=V4.002.0', 200)
    const a = await createDahuaAdapter(makeConfig())
    expect(a.firmware.modelFamily).toBe('nvr_acupick')
    expect(a.capabilities.supportsAiMetadata).toBe(true)
    expect(a.capabilities.eventTypes).toContain('ai_person')
  })

  it('createDahuaAdapter: IPC standard model は単一 channel', async () => {
    // IPC-HF / WIZMIND ではない一般 IPC (例: IPC-CB1C シリーズ) が ipc_standard
    mockFetchOnce('type=DH-IPC-CB1C32A', 200)
    mockFetchOnce('version=V2.800.0', 200)
    const a = await createDahuaAdapter(makeConfig())
    expect(a.firmware.modelFamily).toBe('ipc_standard')
    expect(a.capabilities.maxChannels).toBe(1)
    expect(a.capabilities.supportsVod).toBe(false)
  })
})
