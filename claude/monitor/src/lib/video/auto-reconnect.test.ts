import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import {
  RECONNECT_GIVE_UP_MS, RECONNECT_IDLE, RECONNECT_STABLE_MS, ReconnectController,
  isReconnecting, isRecoverableVideoError, reconnectDelayMs, reconnectStatusText, stepReconnect,
  type ReconnectState,
} from './auto-reconnect'
import { shouldFallbackToJpeg } from './session-logic'

const T0 = Date.parse('2026-09-29T01:00:00Z')

describe('isRecoverableVideoError', () => {
  it.each(['stopped', 'offline', 'timeout', 'internal', 'network', 'play_failed', 'sfu_connect'])(
    '%s はやり直す', (code) => {
      expect(isRecoverableVideoError(code)).toBe(true)
    },
  )

  it.each([
    'busy', 'bandwidth', 'codec_unsupported', 'unknown_camera', 'no_recording',
    'not_supported', 'storage_unavailable', 'sfu_unavailable', 'request_rejected', 'play_unsupported',
    'something_new', '', null, undefined,
  ])('%s はやり直さない', (code) => {
    expect(isRecoverableVideoError(code)).toBe(false)
  })

  it('静止画ライブへ戻す失敗は 1 つもやり直さない（戻すのとやり直すのが競わない）', () => {
    for (const code of ['busy', 'bandwidth', 'codec_unsupported']) {
      expect(shouldFallbackToJpeg(code)).toBe(true)
      expect(isRecoverableVideoError(code)).toBe(false)
    }
  })
})

describe('reconnectDelayMs', () => {
  it('2 → 4 → 8 → 15 秒、以降 15 秒', () => {
    expect([0, 1, 2, 3, 4, 10].map(reconnectDelayMs)).toEqual([2_000, 4_000, 8_000, 15_000, 15_000, 15_000])
  })

  it('負の値は最初の間隔', () => {
    expect(reconnectDelayMs(-1)).toBe(2_000)
  })
})

describe('stepReconnect', () => {
  const failed = (s: ReconnectState, code: string, now: number) => stepReconnect(s, { type: 'failed', code, now })
  const due = (s: ReconnectState, now: number, online = true, visible = true) =>
    stepReconnect(s, { type: 'due', now, online, visible })

  it('やり直せる失敗は 2 秒後に予定する', () => {
    const r = failed(RECONNECT_IDLE, 'stopped', T0)
    expect(r.retry).toBe(false)
    expect(r.state).toEqual({ phase: 'waiting', retries: 0, since: T0, dueAt: T0 + 2_000 })
  })

  it('やり直せない失敗は何もしない', () => {
    for (const code of ['busy', 'unknown_camera', 'no_recording']) {
      expect(failed(RECONNECT_IDLE, code, T0)).toEqual({ state: RECONNECT_IDLE, retry: false })
    }
  })

  it('時刻が来たらやり直し、失敗が続くと間隔を伸ばす', () => {
    let s = failed(RECONNECT_IDLE, 'stopped', T0).state
    let r = due(s, T0 + 2_000)
    expect(r.retry).toBe(true)
    expect(r.state).toMatchObject({ phase: 'retrying', retries: 1, since: T0 })
    s = failed(r.state, 'timeout', T0 + 30_000).state
    expect(s).toMatchObject({ phase: 'waiting', retries: 1, dueAt: T0 + 34_000 })
    r = due(s, T0 + 34_000)
    s = failed(r.state, 'timeout', T0 + 60_000).state
    expect(s).toMatchObject({ phase: 'waiting', retries: 2, dueAt: T0 + 68_000 })
  })

  it('次のやり直しが最初の失敗から 2 分を越えるなら諦める', () => {
    const s: ReconnectState = { phase: 'retrying', retries: 6, since: T0, dueAt: null }
    // 6 回やり直した後の間隔は 15 秒
    expect(failed(s, 'stopped', T0 + RECONNECT_GIVE_UP_MS - 15_000).state)
      .toEqual({ phase: 'waiting', retries: 6, since: T0, dueAt: T0 + RECONNECT_GIVE_UP_MS })
    const r = failed(s, 'stopped', T0 + RECONNECT_GIVE_UP_MS - 14_999)
    expect(r).toEqual({ state: { phase: 'gave_up', retries: 6, since: T0, dueAt: null }, retry: false })
  })

  it('待っている間に重ねて届いた失敗では予定を変えない', () => {
    const s = failed(RECONNECT_IDLE, 'play_failed', T0).state
    expect(failed(s, 'stopped', T0 + 1_000).state).toBe(s)
  })

  it('諦めた後の失敗では何もしない', () => {
    const s: ReconnectState = { phase: 'gave_up', retries: 8, since: T0, dueAt: null }
    expect(failed(s, 'stopped', T0 + 200_000)).toEqual({ state: s, retry: false })
  })

  it('圏外のあいだは時刻が来てもやり直さず、回線待ちにする', () => {
    const s = failed(RECONNECT_IDLE, 'network', T0).state
    const r = due(s, T0 + 2_000, false)
    expect(r.retry).toBe(false)
    expect(r.state.phase).toBe('offline')
  })

  it('画面が隠れているあいだはやり直さない', () => {
    const s = failed(RECONNECT_IDLE, 'stopped', T0).state
    const r = due(s, T0 + 2_000, true, false)
    expect(r.retry).toBe(false)
    expect(r.state.phase).toBe('hidden')
  })

  it('回線が戻ったらすぐやり直し、回数と 2 分を数え直す', () => {
    const s: ReconnectState = { phase: 'offline', retries: 5, since: T0, dueAt: null }
    const r = stepReconnect(s, { type: 'online', now: T0 + 300_000, visible: true })
    expect(r.retry).toBe(true)
    expect(r.state).toEqual({ phase: 'retrying', retries: 1, since: T0 + 300_000, dueAt: null })
  })

  it('次の予定を待っている間に回線が戻っても、待たずにやり直す', () => {
    const s: ReconnectState = { phase: 'waiting', retries: 3, since: T0, dueAt: T0 + 60_000 }
    expect(stepReconnect(s, { type: 'online', now: T0 + 50_000, visible: true }).retry).toBe(true)
  })

  it('諦めた後でも、回線が戻る・画面に戻るとやり直す', () => {
    const s: ReconnectState = { phase: 'gave_up', retries: 9, since: T0, dueAt: null }
    expect(stepReconnect(s, { type: 'online', now: T0 + 1, visible: true }).retry).toBe(true)
    expect(stepReconnect(s, { type: 'visible', now: T0 + 1, online: true }).retry).toBe(true)
  })

  it('画面に戻っても圏外なら回線待ちにする', () => {
    const s: ReconnectState = { phase: 'hidden', retries: 1, since: T0, dueAt: null }
    const r = stepReconnect(s, { type: 'visible', now: T0 + 1, online: false })
    expect(r.retry).toBe(false)
    expect(r.state.phase).toBe('offline')
  })

  it('回線が戻っても画面が隠れていればやり直さない', () => {
    const s: ReconnectState = { phase: 'offline', retries: 1, since: T0, dueAt: null }
    const r = stepReconnect(s, { type: 'online', now: T0 + 1, visible: false })
    expect(r.retry).toBe(false)
    expect(r.state.phase).toBe('hidden')
  })

  it('再生中・やり直しの結果待ちに online / visible が来ても重ねてやり直さない', () => {
    const retrying: ReconnectState = { phase: 'retrying', retries: 1, since: T0, dueAt: null }
    expect(stepReconnect(RECONNECT_IDLE, { type: 'online', now: T0, visible: true }).retry).toBe(false)
    expect(stepReconnect(retrying, { type: 'online', now: T0, visible: true }).retry).toBe(false)
    expect(stepReconnect(retrying, { type: 'visible', now: T0, online: true }).retry).toBe(false)
  })

  it('予定の無いときに時刻が来ても何もしない（取り消し済みの時計）', () => {
    expect(due(RECONNECT_IDLE, T0)).toEqual({ state: RECONNECT_IDLE, retry: false })
  })

  it('映像が続けて出たら数え直す。待っている最中なら変えない', () => {
    const retrying: ReconnectState = { phase: 'retrying', retries: 4, since: T0, dueAt: null }
    expect(stepReconnect(retrying, { type: 'stable' }).state).toEqual(RECONNECT_IDLE)
    const waiting: ReconnectState = { phase: 'waiting', retries: 4, since: T0, dueAt: T0 + 1 }
    expect(stepReconnect(waiting, { type: 'stable' }).state).toBe(waiting)
  })

  it('手で再試行したら数え直す（やり直すのは呼び出し側）', () => {
    const s: ReconnectState = { phase: 'gave_up', retries: 9, since: T0, dueAt: null }
    expect(stepReconnect(s, { type: 'manual' })).toEqual({ state: RECONNECT_IDLE, retry: false })
  })
})

describe('reconnectStatusText / isReconnecting', () => {
  it('状態ごとの文', () => {
    expect(reconnectStatusText({ phase: 'offline', retries: 2, since: T0, dueAt: null })).toBe('回線が戻るのを待っています')
    expect(reconnectStatusText({ phase: 'waiting', retries: 0, since: T0, dueAt: T0 })).toBe('再接続しています（1 回目）')
    expect(reconnectStatusText({ phase: 'retrying', retries: 3, since: T0, dueAt: null })).toBe('再接続しています（3 回目）')
    expect(reconnectStatusText({ phase: 'hidden', retries: 1, since: T0, dueAt: null })).toBe('画面に戻ると再接続します')
    expect(reconnectStatusText(RECONNECT_IDLE)).toBeNull()
    expect(reconnectStatusText({ phase: 'gave_up', retries: 9, since: T0, dueAt: null })).toBeNull()
  })

  it('諦めた・何もしていないときは失敗の文を出す側', () => {
    expect(isReconnecting(RECONNECT_IDLE)).toBe(false)
    expect(isReconnecting({ phase: 'gave_up', retries: 9, since: T0, dueAt: null })).toBe(false)
    expect(isReconnecting({ phase: 'waiting', retries: 0, since: T0, dueAt: T0 })).toBe(true)
  })
})

describe('ReconnectController', () => {
  let online: boolean
  let visible: boolean
  let retry: Mock<() => void>
  let ctl: ReconnectController

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    online = true
    visible = true
    retry = vi.fn<() => void>()
    ctl = new ReconnectController({
      now: () => Date.now(),
      online: () => online,
      visible: () => visible,
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    })
    ctl.setRetry(() => retry())
    ctl.attach()
  })
  afterEach(() => {
    ctl.detach()
    vi.useRealTimers()
  })

  it('機内モード 10 秒の再現: 圏外の間は待ち、online ですぐ 1 回だけやり直す', () => {
    online = false
    ctl.failed('stopped')
    vi.advanceTimersByTime(2_000)
    expect(retry).not.toHaveBeenCalled()
    expect(ctl.getSnapshot().phase).toBe('offline')
    vi.advanceTimersByTime(8_000)
    expect(retry).not.toHaveBeenCalled()
    online = true
    ctl.online()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(ctl.getSnapshot()).toMatchObject({ phase: 'retrying', retries: 1 })
    // つながって 30 秒映れば数え直す
    ctl.setPlaying(true)
    vi.advanceTimersByTime(RECONNECT_STABLE_MS)
    expect(ctl.getSnapshot()).toEqual(RECONNECT_IDLE)
  })

  it('失敗が続くと 2・4・8・15 秒の間隔でやり直し、2 分を過ぎたら諦める', () => {
    const at: number[] = []
    retry.mockImplementation(() => {
      at.push(Date.now() - T0)
      // やり直した先ですぐまた失敗する
      ctl.failed('timeout')
    })
    ctl.failed('stopped')
    vi.advanceTimersByTime(200_000)
    expect(at).toEqual([2_000, 6_000, 14_000, 29_000, 44_000, 59_000, 74_000, 89_000, 104_000, 119_000])
    expect(ctl.getSnapshot()).toMatchObject({ phase: 'gave_up', retries: 10 })
    expect(Math.max(...at)).toBeLessThanOrEqual(RECONNECT_GIVE_UP_MS)
    const n = retry.mock.calls.length
    vi.advanceTimersByTime(600_000)
    expect(retry.mock.calls.length).toBe(n)
  })

  it('つながってすぐ切れる状態では数え直さない（つなぎ直しの繰り返しを防ぐ）', () => {
    ctl.failed('sfu_connect')
    vi.advanceTimersByTime(2_000)
    expect(retry).toHaveBeenCalledTimes(1)
    ctl.setPlaying(true)
    vi.advanceTimersByTime(5_000)
    ctl.failed('sfu_connect')
    expect(ctl.getSnapshot()).toMatchObject({ phase: 'waiting', retries: 1 })
    vi.advanceTimersByTime(RECONNECT_STABLE_MS)
    // 映像が止まったので数え直しの時計は外れている
    expect(ctl.getSnapshot().phase).not.toBe('idle')
  })

  it('画面から外れたらやり直さない', () => {
    ctl.failed('stopped')
    ctl.detach()
    vi.advanceTimersByTime(60_000)
    expect(retry).not.toHaveBeenCalled()
  })

  it('付け直す（StrictMode の付け外し）と待ちの時計をかけ直す', () => {
    ctl.failed('stopped')
    ctl.detach()
    ctl.attach()
    vi.advanceTimersByTime(2_000)
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('画面が隠れている間は待ち、見えたらすぐやり直す', () => {
    visible = false
    ctl.failed('stopped')
    vi.advanceTimersByTime(2_000)
    expect(ctl.getSnapshot().phase).toBe('hidden')
    ctl.visible() // 隠れたまま届いた visibilitychange は無視
    expect(retry).not.toHaveBeenCalled()
    visible = true
    ctl.visible()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('変わったときだけ購読者へ知らせる', () => {
    const fn = vi.fn()
    const off = ctl.subscribe(fn)
    ctl.failed('stopped')
    expect(fn).toHaveBeenCalledTimes(1)
    ctl.failed('stopped')
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    ctl.manual()
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
