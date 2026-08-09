import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workerImageExists } from './edge-images-sign'

/**
 * R2 上に画像があるかの確認 `workerImageExists`。
 *
 * ── なぜ別ファイルなのか ────────────────────────────────────────────────
 * 同じモジュールの署名生成（signEdgeImageUrl / edgeImagesWorkerConfigured）は
 * edge-images-sign.test.ts が押さえている。**押さえられていなかったのは
 * この関数**で、2026-08-09 の変異テストで 20 個の変異が「テストに一度も
 * 触れられていない」と出た。
 *
 * ── 何を守るのか ────────────────────────────────────────────────────────
 * ここは「R2 に無ければ Supabase 経路へ落とす」判断の分かれ目。毎フレーム
 * HEAD を打たないようメモ化しているが、**肯定と否定で保持時間が違う**のが要点:
 *
 *   肯定 60 秒 … 存在するものは変わらない。毎フレーム叩かない
 *   否定  3 秒 … ライブ開始直後の「まだ R2 に無い」を長く覚えると、
 *                そのインスタンスは**その間ずっと取得失敗を返し続ける**
 *
 * この非対称を消すと、ライブ開始が不安定になる（旧実装は Supabase の古い画像で
 * 誤魔化していたが、監視用途で古い映像を出すほうが危険なので出さない）。
 *
 * メモ化はモジュール内の Map なので、テストごとにキーを変えて干渉を避ける。
 */

const h = vi.hoisted(() => ({
  fetchCalls: 0,
  ok: true,
  throws: false,
  lastInit: null as RequestInit | null,
}))

let savedEnv: Record<string, string | undefined> = {}
const ENV = ['EDGE_IMAGES_BASE_URL', 'EDGE_IMAGES_SIGNING_SECRET'] as const

/** キーを毎回変えて、前のテストのメモ化を持ち越さない。 */
let seq = 0
const nextKey = () => `edges/e1/cam/c1/frame-${++seq}.jpg`

beforeEach(() => {
  for (const k of ENV) savedEnv[k] = process.env[k]
  process.env.EDGE_IMAGES_BASE_URL = 'https://img.example.com'
  process.env.EDGE_IMAGES_SIGNING_SECRET = 'k'.repeat(32)
  h.fetchCalls = 0
  h.ok = true
  h.throws = false
  h.lastInit = null
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    h.fetchCalls++
    h.lastInit = init
    if (h.throws) throw new Error('network down')
    return { ok: h.ok } as Response
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  for (const k of ENV) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]!
  }
})

describe('workerImageExists', () => {
  it('HEAD が 200 なら true', async () => {
    expect(await workerImageExists(nextKey())).toBe(true)
  })

  it('HEAD が 404 なら false（Supabase 経路へ落とす）', async () => {
    h.ok = false
    expect(await workerImageExists(nextKey())).toBe(false)
  })

  it('HEAD を使う（本体を取りに行かない）', async () => {
    await workerImageExists(nextKey())
    expect(h.lastInit?.method).toBe('HEAD')
    expect(h.lastInit?.cache, '古い判定を掴まないため no-store であること').toBe('no-store')
  })

  it('ネットワーク例外は false（フェイルクローズ）', async () => {
    h.throws = true
    expect(await workerImageExists(nextKey())).toBe(false)
  })

  it('★署名できない（Worker 未設定）なら叩かずに false', async () => {
    delete process.env.EDGE_IMAGES_BASE_URL
    expect(await workerImageExists(nextKey())).toBe(false)
    expect(h.fetchCalls, '未設定なのに外部へ叩いています').toBe(0)
  })

  it('肯定はメモ化される（毎フレーム HEAD を打たない）', async () => {
    const key = nextKey()
    expect(await workerImageExists(key)).toBe(true)
    expect(await workerImageExists(key)).toBe(true)
    expect(h.fetchCalls).toBe(1)
  })

  it('否定もいったんはメモ化される', async () => {
    h.ok = false
    const key = nextKey()
    expect(await workerImageExists(key)).toBe(false)
    expect(await workerImageExists(key)).toBe(false)
    expect(h.fetchCalls).toBe(1)
  })

  it('★否定は 3 秒で切れる（ライブ開始直後に取得失敗を持ち越さない）', async () => {
    vi.useFakeTimers()
    const key = nextKey()
    h.ok = false
    expect(await workerImageExists(key)).toBe(false)

    vi.advanceTimersByTime(3_500)          // 否定 TTL(3s) を越える
    h.ok = true                            // その間に R2 へ上がった
    expect(await workerImageExists(key), '否定を長く持ちすぎています').toBe(true)
    expect(h.fetchCalls).toBe(2)
  })

  it('★肯定は 60 秒保つ（否定と同じ長さに縮めない）', async () => {
    vi.useFakeTimers()
    const key = nextKey()
    expect(await workerImageExists(key)).toBe(true)

    vi.advanceTimersByTime(10_000)         // 否定 TTL は越えるが肯定 TTL 内
    expect(await workerImageExists(key)).toBe(true)
    expect(h.fetchCalls, '肯定のメモ化が早すぎる時点で切れています').toBe(1)
  })

  it('肯定も 60 秒を過ぎれば再確認する', async () => {
    vi.useFakeTimers()
    const key = nextKey()
    expect(await workerImageExists(key)).toBe(true)
    vi.advanceTimersByTime(61_000)
    expect(await workerImageExists(key)).toBe(true)
    expect(h.fetchCalls).toBe(2)
  })

  it('キーごとに独立して覚える', async () => {
    const a = nextKey()
    const b = nextKey()
    await workerImageExists(a)
    h.ok = false
    expect(await workerImageExists(b)).toBe(false)
    expect(await workerImageExists(a), '別キーの判定が混ざっています').toBe(true)
    expect(h.fetchCalls).toBe(2)
  })
})
