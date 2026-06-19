/**
 * ONVIF GetSnapshotUri 経由の HTTP JPEG スナップ取得。
 *
 * 2026-06-19 実機 (i-PRO カメラ) で確認:
 *   - メインの H264/H265 RTSP は NVR が占有して SETUP=503。
 *   - 一方 ONVIF GetSnapshotUri は HTTP の JPEG 口 (例:
 *     http://<ip>/cgi-bin/camera?resolution=1280) を返し、**RTSP セッションを
 *     消費しない**。grid/live の静止画にはこれが最適 (503回避・ffmpeg不要)。
 *
 * grid/live はまずこの方式を使い、GetSnapshotUri 非対応機のみ RTSP keyframe に
 * フォールバックする (呼び出し側)。
 */
import { OnvifSoapClient, parseDigestChallenge, buildHttpDigest } from './onvif-soap-client'

export interface OnvifSnapshotOptions {
  endpoint:   string   // 'http://192.168.0.102' (ONVIF device/media service の base)
  username:   string
  password:   string
  timeoutMs?: number
}

// host:channel → スナップURL。'' は「この機は GetSnapshotUri 非対応」を意味する負キャッシュ。
const SNAP_URL_CACHE = new Map<string, string>()

/**
 * JPEG/MJPEG プロファイルを優先して GetSnapshotUri を解決。
 * (JPEG プロファイルのスナップが最も軽く・確実)
 */
export async function resolveOnvifSnapshotUrl(
  opts:    OnvifSnapshotOptions,
  channel: number,
  client?: OnvifSoapClient,
): Promise<string> {
  const c = client ?? new OnvifSoapClient(opts)
  const profiles = await c.getProfiles()
  if (profiles.length === 0) throw new Error(`ONVIF: no media profiles at ${opts.endpoint}`)
  const jpeg = profiles.find((p) => /jpe?g|mjpeg/i.test(p.encoding ?? ''))
  const profile = jpeg ?? profiles[channel - 1] ?? profiles[0]
  const uri = await c.getSnapshotUri(profile.token)
  if (!uri) throw new Error('ONVIF: GetSnapshotUri returned empty')
  return uri
}

/**
 * スナップ URL をキャッシュ付きで取得。非対応機は '' を返す (null 化)。
 */
export async function getOnvifSnapshotUrl(
  opts:    OnvifSnapshotOptions,
  host:    string,
  channel: number,
  client?: OnvifSoapClient,
): Promise<string | null> {
  const key = `${host}:${channel}`
  const cached = SNAP_URL_CACHE.get(key)
  if (cached !== undefined) return cached || null
  try {
    const url = await resolveOnvifSnapshotUrl(opts, channel, client)
    SNAP_URL_CACHE.set(key, url)
    return url
  } catch {
    SNAP_URL_CACHE.set(key, '')   // 負キャッシュ: 以後は即フォールバック
    return null
  }
}

/**
 * スナップ URL から JPEG を取得。Basic で試し、401+Digest なら Digest で再試行。
 * @throws HTTP 非2xx / JPEG でない場合。
 */
export async function fetchOnvifJpeg(
  url:  string,
  user: string,
  pass: string,
  timeoutMs = 8_000,
): Promise<Buffer> {
  const basic = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
  const doFetch = async (authHeader: string): Promise<Response> => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      return await fetch(url, { headers: { authorization: authHeader }, signal: ctl.signal })
    } finally {
      clearTimeout(timer)
    }
  }
  let res = await doFetch(basic)
  if (res.status === 401) {
    const challenge = res.headers.get('www-authenticate') ?? ''
    if (/digest/i.test(challenge)) {
      res = await doFetch(buildHttpDigest('GET', url, user, pass, parseDigestChallenge(challenge)))
    }
  }
  if (!res.ok) throw new Error(`ONVIF snapshot HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 2 || buf[0] !== 0xff || buf[1] !== 0xd8) {
    throw new Error(`ONVIF snapshot is not JPEG (${buf.length} bytes)`)
  }
  return buf
}
