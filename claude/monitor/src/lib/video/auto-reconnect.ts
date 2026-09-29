/**
 * 遠隔視聴（HLS ライブ・SFU・HLS 録画再生）の自動の再接続 — React にも fetch にも触れない部分。
 *
 * 2026-09-29 の iPhone の実機試験で、機内モードを 10 秒入れて戻すと
 * 「拠点からの送信が止まりました」のまま止まり、手で「再試行」を押すまで戻らなかった。
 * 携帯の利用者はエレベーターや地下で数秒〜数十秒の圏外を日常的に踏むので、
 * 回線が戻ったら自分でつなぎ直す。
 *
 * 決まり:
 *  - やり直すのは「待てば直るかもしれない」失敗だけ（isRecoverableVideoError）。
 *    busy / bandwidth / codec_unsupported は静止画ライブへ戻す（shouldFallbackToJpeg）ので
 *    ここでは扱わない。unknown_camera / no_recording など、やり直しても変わらないものもやり直さない。
 *  - 間隔は 2 → 4 → 8 → 15 秒、以降 15 秒ごと。次のやり直しが最初の失敗から 2 分を越えるなら諦める
 *    （諦めたら従来どおり理由と「再試行」を出す）。
 *  - 圏外（navigator.onLine が false）の間はやり直さず、`online` を待ってすぐやり直す。
 *    画面が隠れている間もやり直さず（誰も見ていない視聴を拠点に送らせない）、
 *    見えるようになったらすぐやり直す。どちらも待ち時間は数え直す。
 *  - 映像が 30 秒続けて出たら「直った」とみなして回数を数え直す。つながった直後に
 *    切れる状態で 2 秒ごとのやり直しが続かないよう、つながっただけでは数え直さない
 *    （live-livekit-mode.tsx の「切断→再接続ループ」と同じ轍を踏まない）。
 *
 * 視聴セッションの後始末は、やり直すたびに呼び出し側の attempt を進めて
 * useRemoteVideoSession の後始末（DELETE）を通す。加えてクラウドの POST は同じ利用者・
 * 同じカメラの生きているセッションを止めてから新しいものを作るので、圏外で DELETE が
 * 届かなかったセッションも、次のやり直しで止まる（同時視聴の枠を食い続けない）。
 */

/** 自動でやり直す間隔（n 回目の前に待つ時間）。これより後は最後の値を繰り返す。 */
export const RECONNECT_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 15_000]
/** 最初の失敗からこれより後にはやり直さない（諦める）。 */
export const RECONNECT_GIVE_UP_MS = 120_000
/** 映像がこれだけ続けて出たら直ったとみなし、回数を数え直す。 */
export const RECONNECT_STABLE_MS = 30_000

/**
 * 待てば直るかもしれない失敗か。
 *  - stopped: 拠点からの送信が止まった（画面の生存の合図が途切れてクラウドが止めた等）
 *  - offline: 拠点にカメラの映像が届いていない
 *  - timeout: 拠点から応答がない（拠点の回線が切れている等）
 *  - internal: 拠点・クラウドの一時的な失敗（5xx を含む）
 *  - network: 手元の回線が切れていてクラウドへ届かない
 *  - play_failed: 再生の失敗（区切りが取れない等。hls.js の回復できない失敗）
 *  - sfu_connect: 映像の中継（SFU）への接続が切れた・つながらない
 *
 * 次はやり直さない: busy / bandwidth / codec_unsupported（静止画ライブへ戻す）、
 * unknown_camera / no_recording / not_supported / storage_unavailable / sfu_unavailable /
 * request_rejected（4xx）/ play_unsupported（このブラウザでは再生できない）。
 */
const RECOVERABLE = new Set([
  'stopped', 'offline', 'timeout', 'internal', 'network', 'play_failed', 'sfu_connect',
])
export function isRecoverableVideoError(code: string | null | undefined): boolean {
  return !!code && RECOVERABLE.has(code)
}

/** retries 回やり直した後、次のやり直しまでに待つ時間。 */
export function reconnectDelayMs(retries: number): number {
  const i = Math.max(0, Math.min(Math.floor(retries), RECONNECT_DELAYS_MS.length - 1))
  return RECONNECT_DELAYS_MS[i]
}

export type ReconnectPhase =
  /** 何もしていない（再生中・始めていない・やり直さない失敗） */
  | 'idle'
  /** 次のやり直しの時刻を待っている */
  | 'waiting'
  /** 圏外なので回線が戻るのを待っている */
  | 'offline'
  /** 画面が隠れているので、見えるようになるのを待っている */
  | 'hidden'
  /** やり直した。結果（再生か失敗か）を待っている */
  | 'retrying'
  /** 2 分やり直しても戻らなかった */
  | 'gave_up'

export interface ReconnectState {
  phase: ReconnectPhase
  /** いまの連続で自動でやり直した回数 */
  retries: number
  /** いまの連続の最初の失敗の時刻（ms）。連続していなければ null */
  since: number | null
  /** 次にやり直す時刻（waiting のときだけ） */
  dueAt: number | null
}

export const RECONNECT_IDLE: ReconnectState = { phase: 'idle', retries: 0, since: null, dueAt: null }

export type ReconnectEvent =
  /** 失敗が見えた */
  | { type: 'failed'; code: string; now: number }
  /** 待ち時間が過ぎた */
  | { type: 'due'; now: number; online: boolean; visible: boolean }
  /** 回線が戻った（window の online） */
  | { type: 'online'; now: number; visible: boolean }
  /** 画面が見えるようになった（visibilitychange） */
  | { type: 'visible'; now: number; online: boolean }
  /** 映像が RECONNECT_STABLE_MS 続けて出た */
  | { type: 'stable' }
  /** 利用者が手で再試行した（呼び出し側がやり直す。ここは数え直すだけ） */
  | { type: 'manual' }

export interface ReconnectStep {
  state: ReconnectState
  /** true なら呼び出し側がいますぐ視聴を開き直す */
  retry: boolean
}

const WAITING_PHASES: readonly ReconnectPhase[] = ['waiting', 'offline', 'hidden', 'gave_up']

function retryNow(s: ReconnectState, now: number, fresh: boolean): ReconnectStep {
  const base = fresh ? { retries: 0, since: now } : { retries: s.retries, since: s.since ?? now }
  return { state: { phase: 'retrying', retries: base.retries + 1, since: base.since, dueAt: null }, retry: true }
}

/** 状態と出来事から次の状態と「いまやり直すか」を決める。 */
export function stepReconnect(s: ReconnectState, e: ReconnectEvent): ReconnectStep {
  switch (e.type) {
    case 'failed': {
      if (!isRecoverableVideoError(e.code)) return { state: RECONNECT_IDLE, retry: false }
      // 諦めた後や、すでに待っている間に重ねて届いた失敗では予定を変えない
      if (s.phase !== 'idle' && s.phase !== 'retrying') return { state: s, retry: false }
      const since = s.since ?? e.now
      const dueAt = e.now + reconnectDelayMs(s.retries)
      // 次のやり直しが最初の失敗から 2 分を越えるなら、そこで諦める（2 分より後にはやり直さない）
      if (dueAt - since > RECONNECT_GIVE_UP_MS) {
        return { state: { phase: 'gave_up', retries: s.retries, since, dueAt: null }, retry: false }
      }
      return { state: { phase: 'waiting', retries: s.retries, since, dueAt }, retry: false }
    }
    case 'due': {
      if (s.phase !== 'waiting') return { state: s, retry: false }
      if (!e.online) return { state: { ...s, phase: 'offline', dueAt: null }, retry: false }
      if (!e.visible) return { state: { ...s, phase: 'hidden', dueAt: null }, retry: false }
      return retryNow(s, e.now, false)
    }
    case 'online':
    case 'visible': {
      if (!WAITING_PHASES.includes(s.phase)) return { state: s, retry: false }
      const online = e.type === 'online' ? true : e.online
      const visible = e.type === 'visible' ? true : e.visible
      if (!online) return { state: { ...s, phase: 'offline', dueAt: null }, retry: false }
      if (!visible) return { state: { ...s, phase: 'hidden', dueAt: null }, retry: false }
      // 回線・画面が戻ったのは「やり直しが効かなかった」のとは別の話なので、回数と 2 分を数え直す
      return retryNow(s, e.now, true)
    }
    case 'stable':
      return { state: s.phase === 'idle' || s.phase === 'retrying' ? RECONNECT_IDLE : s, retry: false }
    case 'manual':
      return { state: RECONNECT_IDLE, retry: false }
  }
}

/** 自動でつなぎ直している最中か（true の間は失敗の文ではなく状態の文を出す）。 */
export function isReconnecting(s: ReconnectState): boolean {
  return s.phase === 'waiting' || s.phase === 'offline' || s.phase === 'hidden' || s.phase === 'retrying'
}

/** 画面に出す状態の文。自動でつなぎ直していなければ null。 */
export function reconnectStatusText(s: ReconnectState): string | null {
  switch (s.phase) {
    case 'offline': return '回線が戻るのを待っています'
    case 'hidden': return '画面に戻ると再接続します'
    case 'waiting': return `再接続しています（${s.retries + 1} 回目）`
    case 'retrying': return `再接続しています（${s.retries} 回目）`
    default: return null
  }
}

/** 手元の様子（テストでは差し替える）。 */
export interface ReconnectEnv {
  now(): number
  online(): boolean
  visible(): boolean
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/**
 * stepReconnect に時計をつないだもの。React からは useSyncExternalStore で読む
 * （効果の中で setState を呼ばずに済む）。
 */
export class ReconnectController {
  private state: ReconnectState = RECONNECT_IDLE
  private dueTimer: unknown = null
  private stableTimer: unknown = null
  private attached = false
  private readonly listeners = new Set<() => void>()
  /** 視聴を開き直す（呼び出し側の attempt を進める）。描画のたびに変わるので後から差し替える */
  private retry: () => void = () => {}

  constructor(private readonly env: ReconnectEnv) {}

  setRetry(fn: () => void): void {
    this.retry = fn
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  getSnapshot = (): ReconnectState => this.state

  /** 失敗が見えた（同じ失敗を何度渡してもよい。予定は最初の 1 回で決まる） */
  failed(code: string): void {
    this.setPlaying(false)
    this.dispatch({ type: 'failed', code, now: this.env.now() })
  }

  /** 映像が出ているか。出始めてから RECONNECT_STABLE_MS 続けば数え直す */
  setPlaying(playing: boolean): void {
    if (!playing) {
      this.clear('stable')
      return
    }
    if (this.stableTimer != null || !this.attached) return
    this.stableTimer = this.env.setTimeout(() => {
      this.stableTimer = null
      this.dispatch({ type: 'stable' })
    }, RECONNECT_STABLE_MS)
  }

  online(): void {
    this.dispatch({ type: 'online', now: this.env.now(), visible: this.env.visible() })
  }

  visible(): void {
    if (!this.env.visible()) return
    this.dispatch({ type: 'visible', now: this.env.now(), online: this.env.online() })
  }

  /** 手で再試行した。数え直すだけで、開き直すのは呼び出し側 */
  manual(): void {
    this.dispatch({ type: 'manual' })
  }

  /** 画面に付いた（待ち中なら時計をかけ直す）。StrictMode の付け外しでも壊れないように */
  attach(): void {
    this.attached = true
    this.arm()
  }

  /** 画面から外れた。時計を止める（外れた後にやり直さない） */
  detach(): void {
    this.attached = false
    this.clear('due')
    this.clear('stable')
  }

  private dispatch(e: ReconnectEvent): void {
    const step = stepReconnect(this.state, e)
    const changed = step.state !== this.state
    this.state = step.state
    this.arm()
    if (changed) for (const fn of this.listeners) fn()
    if (step.retry && this.attached) this.retry()
  }

  private arm(): void {
    this.clear('due')
    if (!this.attached || this.state.phase !== 'waiting' || this.state.dueAt == null) return
    const wait = Math.max(0, this.state.dueAt - this.env.now())
    this.dueTimer = this.env.setTimeout(() => {
      this.dueTimer = null
      this.dispatch({ type: 'due', now: this.env.now(), online: this.env.online(), visible: this.env.visible() })
    }, wait)
  }

  private clear(which: 'due' | 'stable'): void {
    if (which === 'due' && this.dueTimer != null) {
      this.env.clearTimeout(this.dueTimer)
      this.dueTimer = null
    }
    if (which === 'stable' && this.stableTimer != null) {
      this.env.clearTimeout(this.stableTimer)
      this.stableTimer = null
    }
  }
}
