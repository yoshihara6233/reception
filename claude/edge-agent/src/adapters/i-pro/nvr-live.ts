/**
 * i-PRO NVR ライブ JPEG 取得（push.cgi の multipart MJPEG から1フレーム）。
 *
 * 2026-06-19 実機(NU101)で形式確認:
 *   dlogin→UID → hdrctl.cgi(SCREEN=1X) → push.cgi?CAM&CMD=START&COMP=JPEG
 *   → multipart(--myboundary, Content-type: image/jpeg)ストリーム。各フレームは ffd8…ffd9。
 *
 * grid/live は「カメラ直が届かない店舗(config②)」向けに NVR 経由でJPEGを得る。
 * ストリームを開いて先頭の完全な1フレームを取り出したら閉じる(snapshot的)。
 * UID は endpoint 単位でキャッシュ（頻繁なpollで90秒寿命内に維持される）。
 */
import { parseDigestChallenge, buildHttpDigest } from '../onvif/onvif-soap-client'
import { iproNvrLogin, type IproNvrVodOptions } from './nvr-vod'

export type IproNvrLiveOptions = IproNvrVodOptions

const UID_CACHE = new Map<string, string>()

function insecureFetch(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  return fetch(url, { ...init, signal, tls: { rejectUnauthorized: false } } as unknown as RequestInit)
}

/** Digest GET（非ストリーミング・短命）。401→Digest再試行。 */
async function digestGet(url: string, user: string, pass: string, timeoutMs: number): Promise<Response> {
  const r1 = await insecureFetch(url, { method: 'GET' }, AbortSignal.timeout(timeoutMs))
  if (r1.status !== 401) return r1
  const ch = parseDigestChallenge(r1.headers.get('www-authenticate') ?? '')
  return insecureFetch(url, { method: 'GET', headers: { Authorization: buildHttpDigest('GET', url, user, pass, ch) } }, AbortSignal.timeout(timeoutMs))
}

/** Digest GET（ストリーミング・本体は呼び出し側で読む）。abort は外部 signal で。 */
async function digestGetStream(url: string, user: string, pass: string, signal: AbortSignal): Promise<Response> {
  const r1 = await insecureFetch(url, { method: 'GET' }, AbortSignal.timeout(10_000))
  if (r1.status !== 401) return r1
  const ch = parseDigestChallenge(r1.headers.get('www-authenticate') ?? '')
  return insecureFetch(url, { method: 'GET', headers: { Authorization: buildHttpDigest('GET', url, user, pass, ch) } }, signal)
}

async function getUid(opts: IproNvrLiveOptions): Promise<string> {
  const cached = UID_CACHE.get(opts.endpoint)
  if (cached) return cached
  const uid = await iproNvrLogin(opts)
  UID_CACHE.set(opts.endpoint, uid)
  return uid
}

const SOI = Buffer.from([0xff, 0xd8])
const EOI = Buffer.from([0xff, 0xd9])

/** ストリームから最初の完全な JPEG(ffd8…ffd9)を取り出す。 */
export async function readFirstJpeg(
  body: ReadableStream<Uint8Array>,
  abort: () => void,
): Promise<Buffer> {
  const reader = body.getReader()
  let buf = Buffer.alloc(0)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) buf = Buffer.concat([buf, Buffer.from(value)])
      const soi = buf.indexOf(SOI)
      if (soi >= 0) {
        const eoi = buf.indexOf(EOI, soi + 2)
        if (eoi >= 0) return buf.subarray(soi, eoi + 2)
      }
      if (buf.length > 8_000_000) throw new Error('push.cgi: JPEG not found within 8MB')
    }
  } finally {
    abort()
    try { await reader.cancel() } catch { /* noop */ }
  }
  throw new Error('push.cgi: stream ended before a complete JPEG')
}

/**
 * NVR から指定チャンネルのライブ JPEG を1枚取得。
 * @param channel NVR のカメラ番号 (CAM=)
 */
export async function captureIproNvrJpeg(
  opts:    IproNvrLiveOptions,
  channel: number,
  timeoutMs = 10_000,
): Promise<Buffer> {
  try {
    const uid = await getUid(opts)
    // 再生/ライブのコンテキスト設定（best-effort）
    await digestGet(`${opts.endpoint}/cgi-bin/hdrctl.cgi?UID=${uid}&SCREEN=1X&PC=AS60`, opts.username, opts.password, 8_000)
      .catch(() => undefined)

    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeoutMs)
    const startUrl = `${opts.endpoint}/cgi-bin/push.cgi?UID=${uid}&CAM=${channel}&CMD=START&COMP=JPEG&INTERNETMODE=ON`
    try {
      const res = await digestGetStream(startUrl, opts.username, opts.password, ctrl.signal)
      if (!res.ok || !res.body) throw new Error(`push.cgi HTTP ${res.status}`)
      return await readFirstJpeg(res.body, () => ctrl.abort())
    } finally {
      clearTimeout(timer)
      ctrl.abort()
      // ストリーム停止（best-effort）
      digestGet(`${opts.endpoint}/cgi-bin/push.cgi?UID=${uid}&CAM=${channel}&CMD=STOP&COMP=JPEG`, opts.username, opts.password, 5_000)
        .catch(() => undefined)
    }
  } catch (e) {
    // UID 失効等で失敗したらキャッシュを捨てて次回ログインし直す
    UID_CACHE.delete(opts.endpoint)
    throw e
  }
}
