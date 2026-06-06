/**
 * F46.18: IProBaseAdapter mock テスト
 *
 * 実機 NVR なしで全機能を検証するため、fetch を vitest spy で mock 化する。
 * 結果として F46.29/30 の実機検証前に「ロジックは正しい」と保証できる。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NvrAdapterConfig, FirmwareInfo, NvrCapabilities } from '../../_base'
import { CONSERVATIVE_CAPABILITIES } from '../../_base'
import { IProBaseAdapter, type IProBaseAdapterDeps } from './i-pro-base-adapter'
import { IProCgiClient } from './cgi-client'

// テスト用の具象クラス (abstract 解消) — ヘルパー factory で 'i-pro-nx' を渡す
class TestIProAdapter extends IProBaseAdapter {}

function makeAdapter(
  config:       NvrAdapterConfig,
  firmware:     FirmwareInfo,
  capabilities: NvrCapabilities,
  deps?:        IProBaseAdapterDeps,
): TestIProAdapter {
  return new TestIProAdapter('i-pro-nx', config, firmware, capabilities, deps)
}

function makeFw(modelFamily = 'nx', modelNumber = 'WJ-NX300K', fwMajor = 3): FirmwareInfo {
  return {
    vendor:      'i-pro',
    modelFamily,
    modelNumber,
    fwVersion:   `${fwMajor}.10-0001`,
    fwMajor,
    fwMinor:     10,
    fwPatch:     1,
    detectedAt:  new Date(),
    source:      'cgi',
  }
}

function makeConfig(): NvrAdapterConfig {
  return {
    storeId:     'test-store-1',
    vendor:      'i-pro-nx',
    endpoint:    'http://192.168.50.10:80',
    credentials: { username: 'admin', password: 'secret' },
    options:     {},
    timeoutMs:   5000,
    retryCount:  0,
  }
}

function mockFetchOnce(body: Uint8Array | string, status = 200, contentType = 'text/plain'): void {
  const buf = typeof body === 'string'
    ? new TextEncoder().encode(body)
    : body
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(buf, {
      status,
      headers: { 'content-type': contentType },
    }),
  )
}

describe('IProBaseAdapter (mock fetch)', () => {

  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  // ── testConnection ──

  it('testConnection: 不明 family なら無条件 false', async () => {
    const a = makeAdapter(makeConfig(), makeFw('unknown'), CONSERVATIVE_CAPABILITIES)
    expect(await a.testConnection()).toBe(false)
  })

  it('testConnection: 既知 family + CGI 200 → true', async () => {
    mockFetchOnce('ModelName=WJ-NX300K\nFirmwareVersion=3.10-0001\n', 200)
    const a = makeAdapter(makeConfig(), makeFw(), CONSERVATIVE_CAPABILITIES)
    expect(await a.testConnection()).toBe(true)
  })

  it('testConnection: ネットワークエラー → false (例外を内包)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const a = makeAdapter(makeConfig(), makeFw(), CONSERVATIVE_CAPABILITIES)
    expect(await a.testConnection()).toBe(false)
  })

  // ── getChannelList ──

  it('getChannelList: maxChannels 個のチャンネルを生成', async () => {
    const caps = { ...CONSERVATIVE_CAPABILITIES, maxChannels: 16 }
    const a = makeAdapter(makeConfig(), makeFw(), caps)
    const list = await a.getChannelList()
    expect(list).toHaveLength(16)
    expect(list[0]).toEqual({ index: 1, name: 'ch01', enabled: true })
    expect(list[15]).toEqual({ index: 16, name: 'ch16', enabled: true })
  })

  // ── getSnapshot ──

  it('getSnapshot: JPEG bytes (FF D8 …) を返す', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a])
    mockFetchOnce(jpeg, 200, 'image/jpeg')
    const a = makeAdapter(makeConfig(), makeFw(), {
      ...CONSERVATIVE_CAPABILITIES, maxChannels: 16,
    })
    const buf = await a.getSnapshot(1)
    expect(buf.length).toBeGreaterThan(2)
    expect(buf[0]).toBe(0xff)
    expect(buf[1]).toBe(0xd8)
  })

  it('getSnapshot: 範囲外 ch なら NvrAdapterError', async () => {
    const a = makeAdapter(makeConfig(), makeFw(), {
      ...CONSERVATIVE_CAPABILITIES, maxChannels: 4,
    })
    await expect(a.getSnapshot(99)).rejects.toThrow(/channel 99 out of range/)
  })

  it('getSnapshot: JPEG ヘッダがなければ protocol_error', async () => {
    mockFetchOnce(new Uint8Array([0x00, 0x00, 0x00]), 200, 'image/jpeg')
    const a = makeAdapter(makeConfig(), makeFw(), {
      ...CONSERVATIVE_CAPABILITIES, maxChannels: 4,
    })
    await expect(a.getSnapshot(1)).rejects.toThrow(/not a JPEG/)
  })

  // ── getLiveRtspUri ──

  it('getLiveRtspUri: main stream URL を構築', async () => {
    const a = makeAdapter(makeConfig(), makeFw(), {
      ...CONSERVATIVE_CAPABILITIES, maxChannels: 16,
    })
    const uri = await a.getLiveRtspUri(3, 'main')
    expect(uri).toBe('rtsp://admin:secret@192.168.50.10:554/MediaInput/h264/ch03_main')
  })

  it('getLiveRtspUri: sub stream URL を構築', async () => {
    const a = makeAdapter(makeConfig(), makeFw(), {
      ...CONSERVATIVE_CAPABILITIES, maxChannels: 16,
    })
    const uri = await a.getLiveRtspUri(3, 'sub')
    expect(uri).toBe('rtsp://admin:secret@192.168.50.10:554/MediaInput/h264/ch03_sub')
  })

  it('getLiveRtspUri: 特殊文字 password を URL エンコード', async () => {
    const cfg = makeConfig()
    cfg.credentials = { username: 'admin', password: 'p@ss/w&rd' }
    const a = makeAdapter(cfg, makeFw(), { ...CONSERVATIVE_CAPABILITIES, maxChannels: 16 })
    const uri = await a.getLiveRtspUri(1)
    expect(uri).toContain('p%40ss%2Fw%26rd')
  })

  it('getLiveRtspUri: options.rtsp_port で port を上書き', async () => {
    const cfg = makeConfig()
    cfg.options = { rtsp_port: 8554 }
    const a = makeAdapter(cfg, makeFw(), { ...CONSERVATIVE_CAPABILITIES, maxChannels: 16 })
    const uri = await a.getLiveRtspUri(1)
    expect(uri).toContain(':8554/')
  })

  it('getLiveRtspUri: 範囲外 ch なら NvrAdapterError', async () => {
    const a = makeAdapter(makeConfig(), makeFw(), {
      ...CONSERVATIVE_CAPABILITIES, maxChannels: 4,
    })
    await expect(a.getLiveRtspUri(99)).rejects.toThrow(/channel 99 out of range/)
  })

  // ── 依存性注入 (DI) ──

  it('IProCgiClient を DI で差し替え可能', async () => {
    const mockCgi = {
      get: vi.fn().mockResolvedValue({
        type: 'text', body: 'ok', status: 200, headers: {},
      }),
    } as unknown as IProCgiClient
    const a = makeAdapter(makeConfig(), makeFw(), CONSERVATIVE_CAPABILITIES, {
      cgiClient: mockCgi,
    })
    await a.testConnection()
    expect((mockCgi.get as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith({
      path: '/cgi-bin/getsysteminfo',
    })
  })
})
