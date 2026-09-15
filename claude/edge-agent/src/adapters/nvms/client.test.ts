import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  nvmsEndpoint, fetchNvmsSnapshot, downloadNvmsExportMp4, nvmsExportStatusMessage,
  fetchNvmsGrid, NvmsGridUnsupportedError,
} from './client'

const opts = { endpoint: 'http://192.168.10.5:8080', apiKey: 'nvms_testkey' }
afterEach(() => vi.restoreAllMocks())

/** fetch を差し替え、呼ばれた URL とヘッダを検査できるようにする。 */
function mockFetch(status: number, body: Buffer | string, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return new Response(typeof body === 'string' ? body : new Uint8Array(body), { status, headers })
  }))
  return calls
}

describe('nvmsEndpoint（接続先URLの組み立て）', () => {
  it('素の IP には http:// と既定ポート 8080 を補う', () => {
    expect(nvmsEndpoint('192.168.10.5')).toBe('http://192.168.10.5:8080')
  })
  it('ポート付きはポートを尊重する', () => {
    expect(nvmsEndpoint('192.168.10.5:9000')).toBe('http://192.168.10.5:9000')
  })
  it('スキーム付きはそのまま（末尾スラッシュだけ落とす）', () => {
    expect(nvmsEndpoint('https://nvms.example.local/')).toBe('https://nvms.example.local')
    expect(nvmsEndpoint('http://10.0.0.2:8080')).toBe('http://10.0.0.2:8080')
  })
})

describe('fetchNvmsSnapshot', () => {
  it('Bearer キーを付けて /cameras/{id}/snapshot を叩く', async () => {
    const jpeg = Buffer.alloc(2048, 0xff)
    const calls = mockFetch(200, jpeg)
    const buf = await fetchNvmsSnapshot(opts, 42)
    expect(buf.length).toBe(2048)
    expect(calls[0].url).toBe('http://192.168.10.5:8080/api/v1/cameras/42/snapshot')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer nvms_testkey')
  })
  it('404 は「出力起動中」として投げる（次周期の再試行に任せる）', async () => {
    // NVMS のスナップは要求がトリガーのオンデマンド開始。初回 404 は正常な立ち上がり。
    mockFetch(404, 'not found')
    await expect(fetchNvmsSnapshot(opts, 42)).rejects.toThrow(/出力起動中/)
  })
  it('401/403 はキーの問題だと分かる文で投げる', async () => {
    mockFetch(403, 'forbidden')
    await expect(fetchNvmsSnapshot(opts, 42)).rejects.toThrow(/API キーが無効か権限不足/)
  })
  it('極端に小さい応答は壊れた画像として弾く', async () => {
    mockFetch(200, Buffer.alloc(16))
    await expect(fetchNvmsSnapshot(opts, 42)).rejects.toThrow(/too small/)
  })
})

describe('downloadNvmsExportMp4', () => {
  const mp4 = Buffer.alloc(4096, 0x11)
  const sha = createHash('sha256').update(mp4).digest('hex')

  it('camera_id と ISO 時刻で /recordings/export を叩き、SHA-256 を照合する', async () => {
    const calls = mockFetch(200, mp4, { 'X-Content-SHA256': sha })
    const from = new Date('2026-09-14T00:00:00Z')
    const to   = new Date('2026-09-14T00:05:00Z')
    const buf = await downloadNvmsExportMp4(opts, 7, from, to)
    expect(buf.length).toBe(4096)
    const u = new URL(calls[0].url)
    expect(u.pathname).toBe('/api/v1/recordings/export')
    expect(u.searchParams.get('camera_id')).toBe('7')
    expect(u.searchParams.get('from')).toBe('2026-09-14T00:00:00.000Z')
    expect(u.searchParams.get('to')).toBe('2026-09-14T00:05:00.000Z')
  })

  it('★チェックサム不一致は握りつぶさず捨てる（破損をアップロード前に検知）', async () => {
    mockFetch(200, mp4, { 'X-Content-SHA256': 'deadbeef'.repeat(8) })
    await expect(downloadNvmsExportMp4(opts, 7, new Date(), new Date())).rejects.toThrow(/checksum mismatch/)
  })

  it('ヘッダの無い旧版 NVMS では照合をスキップして通す', async () => {
    mockFetch(200, mp4)
    const buf = await downloadNvmsExportMp4(opts, 7, new Date(), new Date())
    expect(buf.length).toBe(4096)
  })

  it('404 は録画なしの文言（保持期間/未録画に触れる）', async () => {
    mockFetch(404, 'not found')
    await expect(downloadNvmsExportMp4(opts, 7, new Date('2026-07-07T08:38:00+09:00'), new Date()))
      .rejects.toThrow(/録画が見つかりません/)
  })

  it('極小の応答は empty_clip として弾く', async () => {
    mockFetch(200, Buffer.alloc(100))
    await expect(downloadNvmsExportMp4(opts, 7, new Date(), new Date())).rejects.toThrow(/empty_clip/)
  })
})

describe('nvmsExportStatusMessage', () => {
  it('404 は JST 時刻入りで「見つかりません」', () => {
    const msg = nvmsExportStatusMessage(404, new Date('2026-07-07T08:38:00+09:00'))
    expect(msg).toContain('2026/07/07 08:38')
    expect(msg).toContain('見つかりません')
  })
  it('403 は operator キーが要ることを言う', () => {
    expect(nvmsExportStatusMessage(403, new Date())).toContain('operator')
  })
})

describe('fetchNvmsGrid（合成グリッド API）', () => {
  it('cameras の並び順どおりの URL と Bearer キーで grid.jpg を叩く', async () => {
    const jpeg = Buffer.alloc(4096, 0xff)
    const calls = mockFetch(200, jpeg)
    const { jpeg: got, missing } = await fetchNvmsGrid(opts, [100, 65, 300], 1280, 720)
    expect(got.length).toBe(4096)
    expect(missing).toBe('')
    expect(calls[0].url).toBe('http://192.168.10.5:8080/api/v1/grid.jpg?cameras=100,65,300&w=1280&h=720')
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer nvms_testkey')
  })
  it('X-Grid-Missing ヘッダを missing として返す', async () => {
    mockFetch(200, Buffer.alloc(4096), { 'X-Grid-Missing': '65,300' })
    const { missing } = await fetchNvmsGrid(opts, [100, 65, 300], 1280, 720)
    expect(missing).toBe('65,300')
  })
  it('★404 は NvmsGridUnsupportedError（旧版 nvmsd）— 呼び出し側の恒久フォールバック用', async () => {
    // 新版は引数が正しければ常に 200 を返す契約なので、404 = このルートが無い旧版。
    mockFetch(404, 'not found')
    await expect(fetchNvmsGrid(opts, [1], 1280, 720)).rejects.toBeInstanceOf(NvmsGridUnsupportedError)
  })
  it('401/403 はキーの問題だと分かる文で投げる（Unsupported ではない）', async () => {
    mockFetch(403, 'forbidden')
    const p = fetchNvmsGrid(opts, [1], 1280, 720)
    await expect(p).rejects.toThrow(/API キーが無効か権限不足/)
    await expect(fetchNvmsGrid(opts, [1], 1280, 720)).rejects.not.toBeInstanceOf(NvmsGridUnsupportedError)
  })
  it('極端に小さい応答は壊れた画像として弾く', async () => {
    mockFetch(200, Buffer.alloc(100))
    await expect(fetchNvmsGrid(opts, [1], 1280, 720)).rejects.toThrow(/too small/)
  })
})
