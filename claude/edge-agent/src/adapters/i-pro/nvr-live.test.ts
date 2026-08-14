import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * i-PRO NVR の push.cgi は「開きっぱなしのストリーム」。その寿命を誰が握るか。
 *
 * ── 実際に起きた障害（2026-08-14・本番 demo_AI201）────────────────────────
 * 接続用のつもりで `AbortSignal.timeout(10_000)` を渡していた。あれは**本体を
 * 受信している間も動き続ける**ので、ストリームは必ず 10 秒で切れていた。
 * ログ上は毎回きっかり 10.0 秒後に `TimeoutError`。切れるたびに指数バックオフ
 * （2→4→8→16→20秒）で繋ぎ直すため、グリッドは前回フレームを表示したまま
 * **更新だけが約15秒止まる**。「映っているので気づきにくい」形だった。
 *
 * ⚠ NVR は `UID=` 付きの要求に digest を求めず **いきなり 200 を返す**ので、
 *   401 を経由する分岐（外部 signal を渡していた方）には入らない。
 *   「認証が要る前提」で書いたコードが、認証が要らない実機で別経路を通っていた。
 *
 * ここで固定するのは1点: **ヘッダが返ったらタイマーは止まり、以後は
 * 呼び出し側の signal だけが本体を切れる。**
 */

const h = vi.hoisted(() => ({ fetchImpl: null as unknown as (u: string, i: RequestInit) => Promise<Response> }))
vi.mock('../../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
vi.mock('../../config.js', () => ({ config: { FFMPEG_BIN: '/usr/bin/ffmpeg' } }))

import { fetchStreamWithConnectTimeout } from './nvr-live.js'

/** ヘッダは delayMs 後に返し、本体は abort されるまで終わらない応答。 */
function slowHeaders(delayMs: number): Promise<Response> {
  return new Promise((resolve) => setTimeout(() => resolve(new Response('ok')), delayMs))
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => h.fetchImpl(url, init))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('fetchStreamWithConnectTimeout', () => {
  it('★ヘッダが返った後は、接続タイムアウトを過ぎてもストリームが切れない', async () => {
    // これが落ちるとき、症状は「映るが更新が止まる」。エラーにはならない。
    let bodySignal: AbortSignal | undefined
    h.fetchImpl = (_u, init) => {
      bodySignal = init.signal as AbortSignal
      return Promise.resolve(new Response('stream'))
    }
    const outer = new AbortController()
    const res = await fetchStreamWithConnectTimeout('https://nvr/push.cgi', {}, outer.signal, 10_000)
    expect(res.status).toBe(200)

    // 接続制限の 3 倍待っても、本体は生きたまま。
    await vi.advanceTimersByTimeAsync(30_000)
    expect(bodySignal?.aborted).toBe(false)
  })

  it('★呼び出し側の signal は、ヘッダ受信後も本体を切れる', async () => {
    // タイマーを止めるついでに外部 signal の中継まで外すと、今度は止められなく
    // なる（アイドル停止も COMP 切替も効かなくなる）。両立していることを見る。
    let bodySignal: AbortSignal | undefined
    h.fetchImpl = (_u, init) => {
      bodySignal = init.signal as AbortSignal
      return Promise.resolve(new Response('stream'))
    }
    const outer = new AbortController()
    await fetchStreamWithConnectTimeout('https://nvr/push.cgi', {}, outer.signal, 10_000)
    await vi.advanceTimersByTimeAsync(30_000)

    outer.abort()
    expect(bodySignal?.aborted).toBe(true)
  })

  it('ヘッダが返らないうちは接続タイムアウトで打ち切る（無言のNVRに張り付かない）', async () => {
    let bodySignal: AbortSignal | undefined
    h.fetchImpl = (_u, init) => {
      bodySignal = init.signal as AbortSignal
      return slowHeaders(60_000)
    }
    const outer = new AbortController()
    void fetchStreamWithConnectTimeout('https://nvr/push.cgi', {}, outer.signal, 10_000)

    await vi.advanceTimersByTimeAsync(9_000)
    expect(bodySignal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(bodySignal?.aborted).toBe(true)
  })

  it('呼び出し前に abort 済みなら即座に伝わる', async () => {
    let bodySignal: AbortSignal | undefined
    h.fetchImpl = (_u, init) => {
      bodySignal = init.signal as AbortSignal
      return Promise.resolve(new Response('stream'))
    }
    const outer = new AbortController()
    outer.abort()
    await fetchStreamWithConnectTimeout('https://nvr/push.cgi', {}, outer.signal, 10_000)
    expect(bodySignal?.aborted).toBe(true)
  })
})
