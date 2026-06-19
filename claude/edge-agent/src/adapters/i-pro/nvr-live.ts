/**
 * i-PRO NVR ライブ JPEG（push.cgi の multipart MJPEG）。**永続ストリーム方式**。
 *
 * 2026-06-19 実機(NU100)知見:
 *   - push.cgi は「開きっぱなしのストリーム」。毎フレーム START/STOP すると
 *     セッションが飽和し START が 204(空) になる(churn)。
 *   → カメラ(endpoint+channel)ごとに push.cgi を **1本だけ開いて常時受信**し、
 *     最新フレームをメモリにキャッシュ。grid/live はそのキャッシュを即返す。
 *   - UID は接続ごとに取得し status.cgi でキープアライブ。一定時間 grid から
 *     要求が無ければ自動停止して NVR セッションを解放。
 *   - ライブJPEGは低解像・低fps(監視用)。高画質は将来 H.264/H.265+HLS で別実装。
 */
import { logger } from '../../logger.js'
import { parseDigestChallenge, buildHttpDigest } from '../onvif/onvif-soap-client'
import { iproNvrLogin, type IproNvrVodOptions } from './nvr-vod'

export type IproNvrLiveOptions = IproNvrVodOptions

const IDLE_MS      = 30_000   // この時間 grid 要求が無ければストリーム停止
const KEEPALIVE_MS = 60_000   // status.cgi keepalive 間隔(<90秒)
const FIRST_FRAME_WAIT_MS = 9_000

const SOI = Buffer.from([0xff, 0xd8])
const EOI = Buffer.from([0xff, 0xd9])

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function insecureFetch(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  return fetch(url, { ...init, signal, tls: { rejectUnauthorized: false } } as unknown as RequestInit)
}

async function digestGet(url: string, user: string, pass: string, timeoutMs: number): Promise<Response> {
  const r1 = await insecureFetch(url, { method: 'GET' }, AbortSignal.timeout(timeoutMs))
  if (r1.status !== 401) return r1
  const ch = parseDigestChallenge(r1.headers.get('www-authenticate') ?? '')
  return insecureFetch(url, { method: 'GET', headers: { Authorization: buildHttpDigest('GET', url, user, pass, ch) } }, AbortSignal.timeout(timeoutMs))
}

/** Digest GET（ストリーミング・本体は呼び出し側で読む）。abort は外部 signal。 */
async function digestGetStream(url: string, user: string, pass: string, signal: AbortSignal): Promise<Response> {
  const r1 = await insecureFetch(url, { method: 'GET' }, AbortSignal.timeout(10_000))
  if (r1.status !== 401) return r1
  const ch = parseDigestChallenge(r1.headers.get('www-authenticate') ?? '')
  return insecureFetch(url, { method: 'GET', headers: { Authorization: buildHttpDigest('GET', url, user, pass, ch) } }, signal)
}

/**
 * バッファから完全な JPEG(ffd8…ffd9)を全て取り出し、残り(末尾の未完部)を返す。純粋関数。
 */
export function extractJpegFrames(buf: Buffer): { frames: Buffer[]; rest: Buffer } {
  const frames: Buffer[] = []
  let cursor = 0
  for (;;) {
    const soi = buf.indexOf(SOI, cursor)
    if (soi < 0) { cursor = buf.length; break }
    const eoi = buf.indexOf(EOI, soi + 2)
    if (eoi < 0) { cursor = soi; break }      // SOI はあるが EOI 未着 → ここから残す
    frames.push(buf.subarray(soi, eoi + 2))
    cursor = eoi + 2
  }
  return { frames, rest: buf.subarray(cursor) }
}

interface Streamer {
  latest:      Buffer | null
  lastFrameAt: number
  lastReqAt:   number
  stopped:     boolean
}
const STREAMERS = new Map<string, Streamer>()

function keyOf(endpoint: string, channel: number): string {
  return `${endpoint}|${channel}`
}

// ── 共有UID管理 (NVR 1台 = 1 UID を全カメラで共有。UID上限16/503対策) ──
interface UidState {
  uid:     string | null
  pending: Promise<string> | null
  ka:      ReturnType<typeof setInterval> | null
  refs:    number
}
const UID_STATE = new Map<string, UidState>()

/** 参照を1つ確保 (ストリーマ開始時に1回)。 */
function retainNvr(opts: IproNvrLiveOptions): void {
  let st = UID_STATE.get(opts.endpoint)
  if (!st) { st = { uid: null, pending: null, ka: null, refs: 0 }; UID_STATE.set(opts.endpoint, st) }
  st.refs++
}

/** 共有UIDを取得 (無ければ1回だけログイン。並行呼び出しは同じログインを待つ)。ref は変えない。 */
async function getNvrUid(opts: IproNvrLiveOptions): Promise<string> {
  const st = UID_STATE.get(opts.endpoint)
  if (!st) throw new Error('i-pro-nvr: uid state missing (retain not called)')
  if (st.uid) return st.uid
  if (!st.pending) {
    st.pending = (async () => {
      const uid = await iproNvrLogin(opts)
      st.uid = uid
      if (!st.ka) {
        st.ka = setInterval(() => {
          if (st.uid) digestGet(`${opts.endpoint}/cgi-bin/status.cgi?UID=${st.uid}&PC=AS60`, opts.username, opts.password, 8_000).catch(() => undefined)
        }, KEEPALIVE_MS)
      }
      return uid
    })()
    st.pending.finally(() => { st.pending = null }).catch(() => undefined)
  }
  return st.pending
}

/** UID が失効(401/503等)した時に破棄。次の getNvrUid で再ログイン。 */
function invalidateUid(endpoint: string): void {
  const st = UID_STATE.get(endpoint)
  if (st) st.uid = null
}

/** 参照を1つ手放す。0になったら keepalive 停止＋logout。 */
function releaseNvr(opts: IproNvrLiveOptions): void {
  const st = UID_STATE.get(opts.endpoint)
  if (!st) return
  st.refs = Math.max(0, st.refs - 1)
  if (st.refs === 0) {
    if (st.ka) clearInterval(st.ka)
    const uid = st.uid
    UID_STATE.delete(opts.endpoint)
    if (uid) digestGet(`${opts.endpoint}/cgi-bin/logout.cgi?UID=${uid}`, opts.username, opts.password, 5_000).catch(() => undefined)
  }
}

/** push.cgi を常時受信し、最新フレームを s.latest に反映し続ける（共有UID・自己再接続）。 */
async function runStreamLoop(opts: IproNvrLiveOptions, channel: number, s: Streamer, key: string): Promise<void> {
  let backoff = 2_000
  retainNvr(opts)   // 共有UIDの参照を1つ確保 (このストリーマの生存中)
  while (!s.stopped && STREAMERS.get(key) === s) {
    if (Date.now() - s.lastReqAt > IDLE_MS) break   // アイドル停止
    const ctrl = new AbortController()
    try {
      const uid = await getNvrUid(opts)   // NVR共有UID (両カメラで1つ)
      await digestGet(`${opts.endpoint}/cgi-bin/hdrctl.cgi?UID=${uid}&SCREEN=1X&PC=AS60`, opts.username, opts.password, 8_000).catch(() => undefined)

      const url = `${opts.endpoint}/cgi-bin/push.cgi?UID=${uid}&CAM=${channel}&CMD=START&COMP=JPEG&INTERNETMODE=ON`
      const res = await digestGetStream(url, opts.username, opts.password, ctrl.signal)
      if (res.status === 401) { invalidateUid(opts.endpoint); throw new Error('push.cgi 401 (UID失効)') }
      if (!res.ok || !res.body) throw new Error(`push.cgi HTTP ${res.status}`)
      logger.info({ key, status: res.status, ct: res.headers.get('content-type') }, 'i-pro-nvr: push connected')

      const reader = res.body.getReader()
      let acc: Buffer = Buffer.alloc(0)
      let bytes = 0          // この接続で受信した総バイト
      let frameCount = 0     // この接続で取り出した総フレーム
      for (;;) {
        if (s.stopped || STREAMERS.get(key) !== s || Date.now() - s.lastReqAt > IDLE_MS) { ctrl.abort(); break }
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          if (bytes === 0) logger.info({ key, chunk: value.byteLength }, 'i-pro-nvr: first bytes received')
          bytes += value.byteLength
          acc = Buffer.concat([acc, Buffer.from(new Uint8Array(value))])
        }
        const { frames, rest } = extractJpegFrames(acc)
        if (frames.length) {
          const f = frames[frames.length - 1]
          const out = Buffer.alloc(f.length)   // Buffer<ArrayBuffer> を確保
          f.copy(out)
          if (frameCount === 0) logger.info({ key, jpegBytes: out.length }, 'i-pro-nvr: first frame decoded')
          frameCount += frames.length
          s.latest = out
          s.lastFrameAt = Date.now()
        }
        acc = rest.length > 4_000_000 ? Buffer.alloc(0) : rest   // 壊れ対策
      }
      logger.info({ key, bytes, frameCount }, 'i-pro-nvr: push loop ended')
      // 正常に抜けた場合は push STOP だけ送る (UIDは共有なのでログアウトしない)
      const cur = UID_STATE.get(opts.endpoint)?.uid
      if (cur) digestGet(`${opts.endpoint}/cgi-bin/push.cgi?UID=${cur}&CAM=${channel}&CMD=STOP&COMP=JPEG`, opts.username, opts.password, 5_000).catch(() => undefined)
      backoff = 2_000
    } catch (e) {
      const msg = String(e)
      if (/HTTP 503/.test(msg)) invalidateUid(opts.endpoint)   // UID上限等 → 取り直し
      logger.warn({ key, err: msg }, 'i-pro-nvr: stream error; will reconnect')
      await sleep(backoff)
      backoff = Math.min(backoff * 2, 20_000)
    } finally {
      ctrl.abort()
    }
  }
  STREAMERS.delete(key)
  releaseNvr(opts)   // 参照を返す (0なら logout)
  logger.info({ key }, 'i-pro-nvr: stream stopped')
}

function ensureStreamer(opts: IproNvrLiveOptions, channel: number): Streamer {
  const key = keyOf(opts.endpoint, channel)
  let s = STREAMERS.get(key)
  if (s) { s.lastReqAt = Date.now(); return s }
  s = { latest: null, lastFrameAt: 0, lastReqAt: Date.now(), stopped: false }
  STREAMERS.set(key, s)
  void runStreamLoop(opts, channel, s, key)
  logger.info({ key }, 'i-pro-nvr: stream started')
  return s
}

/**
 * NVR から指定チャンネルのライブ JPEG を1枚返す（永続ストリームの最新フレーム）。
 * 初回はフレーム到着まで最大 FIRST_FRAME_WAIT_MS 待つ。
 */
export async function captureIproNvrJpeg(opts: IproNvrLiveOptions, channel: number): Promise<Buffer> {
  const s = ensureStreamer(opts, channel)
  if (s.latest) return s.latest
  const deadline = Date.now() + FIRST_FRAME_WAIT_MS
  while (Date.now() < deadline) {
    await sleep(200)
    if (s.latest) return s.latest
  }
  logger.warn({ ch: channel, key: keyOf(opts.endpoint, channel), waitedMs: FIRST_FRAME_WAIT_MS }, 'i-pro-nvr: no frame yet')
  throw new Error(`i-pro-nvr: no frame yet (ch=${channel})`)
}
