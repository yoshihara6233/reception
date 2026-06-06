/**
 * F50.G: Frigate Adapter リグレッションテスト
 *
 * 既存の per_store_minipc モード (Frigate 直叩き) を adapter 経由に置換した
 * ので、Mini PC モードが破壊されていないことを保証する。
 *
 * fetch を mock 化して以下を検証:
 *   - testConnection: /api/config を叩いて 200 で OK
 *   - getSnapshot:    /api/<camera>/latest.jpg から JPEG を取得
 *   - getLiveRtspUri: rtsp://host:8554/<camera>[_sub] URL を構築
 *   - getVodMp4:      /api/<camera>/start/<unix>/end/<unix>/clip.mp4
 *   - getTimelineSnapshots: 8 枚のスナップショット取得 (過去オフセットは
 *                            現在 latest で代替)
 *   - getChannelList: cameraMap or 命名規約から生成
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NvrAdapterConfig } from '../_base'
import { FrigateAdapter, createFrigateAdapter } from './frigate-adapter'

function makeConfig(options: Record<string, unknown> = {}): NvrAdapterConfig {
  return {
    storeId:     'store-test',
    vendor:      'frigate',
    endpoint:    'http://192.168.1.120:5000',
    credentials: { username: '', password: '' },
    options,
    timeoutMs:   5000,
    retryCount:  0,
  }
}

function mockFetchOnce(body: Uint8Array | string, status = 200, contentType?: string): void {
  const buf = typeof body === 'string'
    ? new TextEncoder().encode(body)
    : body
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(buf, {
      status,
      headers: contentType ? { 'content-type': contentType } : {},
    }),
  )
}

const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

describe('FrigateAdapter', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  afterEach(() => { vi.restoreAllMocks() })

  it('createFrigateAdapter で FrigateAdapter インスタンスが返る', async () => {
    const a = await createFrigateAdapter(makeConfig())
    expect(a.vendor).toBe('frigate')
    expect(a.capabilities.supportsSnapshot).toBe(true)
    expect(a.capabilities.supportsLiveRtsp).toBe(true)
    expect(a.capabilities.supportsVod).toBe(true)
    expect(a.capabilities.supportsTimelineSnapshot).toBe(true)
  })

  it('testConnection: /api/config の 200 で true', async () => {
    mockFetchOnce('{"cameras":{}}', 200, 'application/json')
    const a = new FrigateAdapter(makeConfig())
    expect(await a.testConnection()).toBe(true)
  })

  it('testConnection: 404 なら false', async () => {
    mockFetchOnce('', 404)
    const a = new FrigateAdapter(makeConfig())
    expect(await a.testConnection()).toBe(false)
  })

  it('testConnection: ネットワークエラー → false', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const a = new FrigateAdapter(makeConfig())
    expect(await a.testConnection()).toBe(false)
  })

  it('getSnapshot: camera_NN 規約で URL 構築 + JPEG ヘッダ検証', async () => {
    mockFetchOnce(JPEG_MAGIC, 200, 'image/jpeg')
    const a = new FrigateAdapter(makeConfig())
    const buf = await a.getSnapshot(3)
    expect(buf.length).toBeGreaterThan(0)
    expect(buf[0]).toBe(0xff); expect(buf[1]).toBe(0xd8)

    // fetch 呼び出し URL を検証
    const fetchSpy = vi.mocked(globalThis.fetch)
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/camera_03/latest.jpg'),
      expect.anything(),
    )
  })

  it('getSnapshot: cameraMap で camera 名を上書き', async () => {
    mockFetchOnce(JPEG_MAGIC, 200, 'image/jpeg')
    const a = new FrigateAdapter(makeConfig({
      cameraMap: { 1: 'entrance', 2: 'backroom' },
    }))
    await a.getSnapshot(1)
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      expect.stringContaining('/api/entrance/latest.jpg'),
      expect.anything(),
    )
  })

  it('getSnapshot: 非 JPEG レスポンスで protocol_error', async () => {
    mockFetchOnce(new Uint8Array([0, 0, 0, 0]), 200, 'image/jpeg')
    const a = new FrigateAdapter(makeConfig())
    await expect(a.getSnapshot(1)).rejects.toThrow(/not a JPEG/)
  })

  it('getSnapshot: 5xx で transient エラー', async () => {
    mockFetchOnce('', 500)
    const a = new FrigateAdapter(makeConfig())
    await expect(a.getSnapshot(1)).rejects.toThrow(/frigate snapshot 500/)
  })

  it('getLiveRtspUri: main stream は <camera>', async () => {
    const a = new FrigateAdapter(makeConfig())
    const uri = await a.getLiveRtspUri(5, 'main')
    expect(uri).toBe('rtsp://192.168.1.120:8554/camera_05')
  })

  it('getLiveRtspUri: sub stream は <camera>_sub', async () => {
    const a = new FrigateAdapter(makeConfig())
    const uri = await a.getLiveRtspUri(5, 'sub')
    expect(uri).toBe('rtsp://192.168.1.120:8554/camera_05_sub')
  })

  it('getLiveRtspUri: rtspPort オプション上書き', async () => {
    const a = new FrigateAdapter(makeConfig({ rtspPort: 18554 }))
    const uri = await a.getLiveRtspUri(1)
    expect(uri).toContain(':18554/')
  })

  it('getLiveRtspUri: 認証情報あれば auth を埋める', async () => {
    const cfg = makeConfig()
    cfg.credentials = { username: 'admin', password: 'p@ss' }
    const a = new FrigateAdapter(cfg)
    const uri = await a.getLiveRtspUri(1)
    expect(uri).toContain('admin:p%40ss@')
  })

  it('getVodMp4: /api/<camera>/start/<unix>/end/<unix>/clip.mp4', async () => {
    // Web ReadableStream を mock しないと Readable.fromWeb が失敗するので
    // 直接 ReadableStream を返す
    const stream = new ReadableStream({ start: (c) => { c.enqueue(new Uint8Array([1, 2, 3])); c.close() } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(stream, { status: 200, headers: { 'content-type': 'video/mp4' } }),
    )
    const a = new FrigateAdapter(makeConfig())
    const from = new Date('2026-06-04T10:00:00Z')
    const to   = new Date('2026-06-04T10:30:00Z')
    const result = await a.getVodMp4(2, from, to)
    expect(result).toBeDefined()

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/camera_02\/start\/\d+\/end\/\d+\/clip\.mp4/),
      expect.anything(),
    )
  })

  it('getChannelList: channelCount から 16 個生成', async () => {
    const a = new FrigateAdapter(makeConfig({ channelCount: 16 }))
    const list = await a.getChannelList()
    expect(list).toHaveLength(16)
    expect(list[0]).toEqual({ index: 1, name: 'camera_01', enabled: true })
    expect(list[15]).toEqual({ index: 16, name: 'camera_16', enabled: true })
  })

  it('getChannelList: cameraMap を優先', async () => {
    const a = new FrigateAdapter(makeConfig({
      cameraMap: { 1: 'entrance', 2: 'backroom', 3: 'parking' },
    }))
    const list = await a.getChannelList()
    expect(list).toHaveLength(3)
    expect(list[0].name).toBe('entrance')
    expect(list[2].name).toBe('parking')
  })

  it('getTimelineSnapshots: 過去オフセットは現在の latest.jpg で代替', async () => {
    // 3 つのオフセット (-5, 0, 5) を要求 → 3 回の fetch
    for (let i = 0; i < 3; i++) mockFetchOnce(JPEG_MAGIC, 200, 'image/jpeg')

    const a = new FrigateAdapter(makeConfig())
    // referenceAt を 60分前にすることで T+0, T+5 も「過去」となり待ち時間なし
    const ref = new Date(Date.now() - 60 * 60_000)
    const results = await a.getTimelineSnapshots(1, ref, [-5, 0, 5])

    expect(results).toHaveLength(3)
    for (const buf of results) {
      expect(buf.length).toBeGreaterThan(0)
      expect(buf[0]).toBe(0xff)
    }
  })

  it('getTimelineSnapshots: 失敗箇所は空 Buffer で埋める', async () => {
    mockFetchOnce(JPEG_MAGIC, 200, 'image/jpeg')   // 1 回成功
    mockFetchOnce('', 500)                          // 2 回目失敗
    mockFetchOnce(JPEG_MAGIC, 200, 'image/jpeg')   // 3 回成功

    const a = new FrigateAdapter(makeConfig())
    const ref = new Date(Date.now() - 60 * 60_000)
    const results = await a.getTimelineSnapshots(1, ref, [-10, -5, 0])
    expect(results).toHaveLength(3)
    expect(results[0].length).toBeGreaterThan(0)
    expect(results[1].length).toBe(0)       // 失敗箇所
    expect(results[2].length).toBeGreaterThan(0)
  })

  it('apiPort オプションで /api ポートを変更可能', async () => {
    mockFetchOnce('{}', 200, 'application/json')
    const a = new FrigateAdapter(makeConfig({ apiPort: 15000 }))
    await a.testConnection()
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledWith(
      expect.stringContaining(':15000/'),
      expect.anything(),
    )
  })
})
