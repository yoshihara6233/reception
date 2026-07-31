/**
 * i-PRO NVR VOD ダウンロード（録画MP4取得）。CGI: httpdl.cgi。
 *
 * 2026-06-19 実機(NU101)で取得実証（5分≈50MB・X-RecData-Satus:0・ftypmp42）。
 * 詳細・落とし穴は docs/vendor/ipro-cgi-notes.md。要点:
 *  - フロー: dlogin.cgi(digest)→HTMLからUID → httpdl.cgi(KIND=MP4) → logout.cgi
 *  - **STARTTIME/ENDTIME は UTC**（recordedtime はローカル表示だが httpdl 入力はUTC）。
 *    → ここでは Date(絶対時刻) を **UTC** で yymmddhhmm00 に整形（ss=00固定）。
 *  - 応答は multipart/form-data(--myboundary)。octet-stream パート本体を連結＝再生可能MP4。
 *  - NVR は HTTPS 自己署名 → TLS 検証なしで叩く（Bun の tls オプション）。
 */
import { parseDigestChallenge, buildHttpDigest } from '../onvif/onvif-soap-client'
import { Semaphore } from '../../util/semaphore'

export interface IproNvrVodOptions {
  endpoint:   string   // 'https://192.168.0.250'
  username:   string
  password:   string
  timeoutMs?: number
}

/** 自己署名 HTTPS を許容する fetch（Bun: tls.rejectUnauthorized=false）。 */
function insecureFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const merged = { ...init, signal: AbortSignal.timeout(timeoutMs), tls: { rejectUnauthorized: false } }
  return fetch(url, merged as unknown as RequestInit)
}

/** Digest 認証付き GET。401+challenge を受けたら Digest で再試行。 */
async function digestGet(url: string, user: string, pass: string, timeoutMs: number): Promise<Response> {
  const r1 = await insecureFetch(url, { method: 'GET' }, timeoutMs)
  if (r1.status !== 401) return r1
  const ch = parseDigestChallenge(r1.headers.get('www-authenticate') ?? '')
  const auth = buildHttpDigest('GET', url, user, pass, ch)
  return insecureFetch(url, { method: 'GET', headers: { Authorization: auth } }, timeoutMs)
}

/** Date を **UTC** の yymmddhhmm00 に整形（httpdl の STARTTIME/ENDTIME 用・ss=00固定）。 */
export function toIproUtcStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
       + `${p(d.getUTCHours())}${p(d.getUTCMinutes())}00`
}

const MINUTE_MS = 60_000

/**
 * httpdl は分単位（秒00固定）。窓 [from,to] を「START=分切り捨て / END=分切り上げ」に
 * 丸めた STARTTIME/ENDTIME に変換する。これをしないと、検査窓が同一分内に収まる短い
 * 検査（例 08:33:05〜08:33:20）で START==END になり、NVR が空応答（録画なし）を返して
 * 取得が恒久失敗する（手荷物検査の短窓クリップで頻発）。丸めた範囲は元の窓を必ず包含し、
 * 最短でも1分＝START<END を保証する（余分な尺は検査窓を含むので確認上は無害）。
 */
export function iproVodMinuteRange(from: Date, to: Date): { startStamp: string; endStamp: string } {
  const startMs = Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS
  let endMs = Math.ceil(to.getTime() / MINUTE_MS) * MINUTE_MS
  if (endMs <= startMs) endMs = startMs + MINUTE_MS
  return { startStamp: toIproUtcStamp(new Date(startMs)), endStamp: toIproUtcStamp(new Date(endMs)) }
}

function splitOnBuffer(buf: Buffer, delim: Buffer): Buffer[] {
  const parts: Buffer[] = []
  let start = 0
  let idx: number
  while ((idx = buf.indexOf(delim, start)) !== -1) {
    parts.push(buf.subarray(start, idx))
    start = idx + delim.length
  }
  parts.push(buf.subarray(start))
  return parts
}

/**
 * httpdl の multipart 応答から MP4 本体を取り出す。
 * 返り値 status は X-RecData-Satus（0=正常 / 1=録画なし / 2=コーデック非対応 / 3=同時超過）。
 */
export function extractMp4FromMultipart(buf: Buffer): { mp4: Buffer; status: number } {
  const firstNl = buf.indexOf('\r\n')
  if (firstNl < 0) return { mp4: Buffer.alloc(0), status: -1 }
  const boundary = buf.subarray(0, firstNl)   // 例: '--myboundary'
  const chunks: Buffer[] = []
  let status = -1
  for (const seg of splitOnBuffer(buf, boundary)) {
    const he = seg.indexOf('\r\n\r\n')
    if (he < 0) continue
    const headers = seg.subarray(0, he).toString('latin1')
    const sm = headers.match(/X-RecData-Satus:\s*(\d+)/i)
    if (sm) status = Number(sm[1])
    if (!/octet-stream/i.test(headers)) continue
    let body = seg.subarray(he + 4)
    // 末尾の CRLF（次 boundary 直前）を除去
    while (body.length && (body[body.length - 1] === 0x0a || body[body.length - 1] === 0x0d)) {
      body = body.subarray(0, body.length - 1)
    }
    if (body.length) chunks.push(body)
  }
  return { mp4: Buffer.concat(chunks), status }
}

/** dlogin → UID。HTML 本文中の `UID=<n>` を抽出。 */
export async function iproNvrLogin(opts: IproNvrVodOptions): Promise<string> {
  const t = opts.timeoutMs ?? 15_000
  const res = await digestGet(`${opts.endpoint}/cgi-bin/dlogin.cgi?UID=-1`, opts.username, opts.password, t)
  if (!res.ok) throw new Error(`i-PRO NVR login HTTP ${res.status}`)
  const html = await res.text()
  const uid = html.match(/UID=(\d+)/)?.[1]
  if (!uid) throw new Error('i-PRO NVR login: UID not found in response')
  return uid
}

export async function iproNvrLogout(opts: IproNvrVodOptions, uid: string): Promise<void> {
  try {
    await digestGet(`${opts.endpoint}/cgi-bin/logout.cgi?UID=${uid}`, opts.username, opts.password, opts.timeoutMs ?? 8_000)
  } catch {
    // ログアウト失敗は致命ではない（UIDは90秒で失効）
  }
}

/**
 * 指定チャンネル・時間範囲（絶対時刻 Date）の録画を MP4 で取得。
 * @param channel NVR のカメラ番号（CAM=）
 * @param from/to 取得範囲（差 ≤ 1時間）。内部で UTC に整形して送る。
 * @throws status≠0（録画なし/非対応/同時超過）や HTTP エラー時。
 */
/**
 * NVR 1 台あたりの再生ダウンロード同時実行を 2 本に制限するセマフォ。
 *
 * 2026-08-01 の NU101 実測で「再生系ダウンロードは同時 2 本まで。3 本目からは
 * 即時 X-RecData-Satus=3（ビジー）」と確認。VOD・検査クリップ・BCP の録画
 * 切り出しが重なると 3 本目が確実に失敗しリトライ頼みになるため、エッジ側で
 * dlogin〜logout のセッション全体を NVR(endpoint) 単位で 2 本に絞って直列化する。
 */
const NVR_PLAYBACK_LIMIT = 2
const playbackSlots = new Map<string, Semaphore>()

export function nvrPlaybackSemaphore(endpoint: string): Semaphore {
  const key = endpoint.trim().toLowerCase().replace(/\/+$/, '')
  let sem = playbackSlots.get(key)
  if (!sem) {
    sem = new Semaphore(NVR_PLAYBACK_LIMIT)
    playbackSlots.set(key, sem)
  }
  return sem
}

export async function downloadIproNvrMp4(
  opts:    IproNvrVodOptions,
  channel: number,
  from:    Date,
  to:      Date,
): Promise<Buffer> {
  return nvrPlaybackSemaphore(opts.endpoint).run(() =>
    downloadIproNvrMp4Inner(opts, channel, from, to))
}

async function downloadIproNvrMp4Inner(
  opts:    IproNvrVodOptions,
  channel: number,
  from:    Date,
  to:      Date,
): Promise<Buffer> {
  const t = opts.timeoutMs ?? 60_000
  const uid = await iproNvrLogin(opts)
  try {
    // 分単位丸め（START=切り捨て/END=切り上げ）。同一分窓での START==END を防ぐ。
    const { startStamp, endStamp } = iproVodMinuteRange(from, to)
    const url = `${opts.endpoint}/cgi-bin/httpdl.cgi?UID=${uid}`
      + `&STARTTIME=${startStamp}&ENDTIME=${endStamp}`
      + `&KIND=MP4&CAM=${channel}&PC=AS60`
    const res = await digestGet(url, opts.username, opts.password, t)
    if (!res.ok) throw new Error(`i-PRO NVR httpdl HTTP ${res.status}`)
    const { mp4, status } = extractMp4FromMultipart(Buffer.from(await res.arrayBuffer()))
    if (status !== 0) {
      const reason = status === 1 ? '指定時間帯に録画なし'
        : status === 2 ? 'コーデック非対応(MP4はJPEG不可)'
        : status === 3 ? '同時処理超過' : `status=${status}`
      throw new Error(`i-PRO NVR VOD 取得不可: ${reason}`)
    }
    if (mp4.length < 8) throw new Error('i-PRO NVR VOD: 空のMP4')
    return mp4
  } finally {
    await iproNvrLogout(opts, uid)
  }
}
