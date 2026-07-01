/**
 * 巡回スナップショット取得（SECURITY / 直接JPEG優先）。
 *
 * 取得経路の優先順位:
 *   1. Frigate      … HTTP API の latest.jpg を直取り
 *   2. ONVIF 直接   … カメラの ONVIF GetSnapshotUri が返す URL を Basic→Digest 認証で
 *                     直取り（カメラ内で JPEG エンコード。RTSP/変換を経由しないので速い）
 *   3. go2rtc 現フレーム … 上記が無い/失敗時のフォールバック（H.265 はオンデマンド変換で遅い）
 *
 * ONVIF スナップ URI は機器問い合わせが要るのでカメラ毎にキャッシュする。
 */
import { Buffer } from 'node:buffer'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { snapshotUrl } from '../rtsp/url.js'
import { go2rtcStreamName } from '../go2rtc/sync.js'
import { OnvifSoapClient, parseDigestChallenge, buildHttpDigest } from '../adapters/onvif/onvif-soap-client.js'
import type { CameraDescriptor } from '../types.js'

/** cameraId → ONVIF snapshot URI（解決成功のみキャッシュ。失敗は都度再試行）。 */
const onvifUriCache = new Map<string, string>()

/** ONVIF GetProfiles→GetSnapshotUri で snapshot URI を解決（JPEG プロファイル優先）。 */
async function resolveOnvifSnapshotUri(cam: CameraDescriptor): Promise<string | null> {
  const cached = onvifUriCache.get(cam.id)
  if (cached) return cached
  const r = cam.recorder
  const endpoint = `http://${r.host}:${r.onvif_port ?? 80}`
  const client = new OnvifSoapClient({ endpoint, username: r.username, password: r.password, timeoutMs: 8_000 })
  const profiles = await client.getProfiles()
  if (!profiles.length) return null
  const prof = profiles.find((p) => /jpe?g/i.test(p.encoding ?? '')) ?? profiles[0]
  const uri = await client.getSnapshotUri(prof.token)
  if (uri) onvifUriCache.set(cam.id, uri)
  return uri || null
}

/** snapshot URI を Basic で取得、401(Digest) なら Digest で再試行して JPEG バイトを返す。 */
async function fetchSnapshotWithAuth(
  uri: string, user: string, pass: string, signal: AbortSignal,
): Promise<ArrayBuffer> {
  const basic = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
  let res = await fetch(uri, { headers: { Authorization: basic }, signal })
  if (res.status === 401) {
    const wa = res.headers.get('www-authenticate') ?? ''
    if (/digest/i.test(wa)) {
      const auth = buildHttpDigest('GET', uri, user, pass, parseDigestChallenge(wa))
      res = await fetch(uri, { headers: { Authorization: auth }, signal })
    }
  }
  if (!res.ok) throw new Error(`snapshot http ${res.status}`)
  return res.arrayBuffer()
}

/**
 * カメラ 1 台の JPEG を「最速に取れる経路」で取得する。
 * 経由手段は via で返す（ログ/診断用）。取得不能は例外。
 */
export async function captureCameraJpeg(
  cam: CameraDescriptor,
  signal: AbortSignal,
): Promise<{ bytes: ArrayBuffer; via: string }> {
  // 1. Frigate は latest.jpg 直取り
  const frigateUrl = snapshotUrl({
    vendor:         cam.recorder.vendor,
    host:           cam.recorder.host,
    port:           cam.recorder.rtsp_port,
    username:       cam.recorder.username,
    password:       cam.recorder.password,
    channel:        cam.channel,
    frigateCamera:  cam.frigate_camera ?? undefined,
    frigateApiPort: config.FRIGATE_API_PORT,
  })
  if (frigateUrl) {
    const r = await fetch(frigateUrl, { signal })
    if (!r.ok) throw new Error(`frigate snapshot ${r.status}`)
    return { bytes: await r.arrayBuffer(), via: 'frigate' }
  }

  // 2. ONVIF 直接スナップ（カメラ内 JPEG。速い）
  if (cam.recorder.vendor === 'onvif-generic') {
    try {
      const uri = await resolveOnvifSnapshotUri(cam)
      if (uri) {
        const bytes = await fetchSnapshotWithAuth(uri, cam.recorder.username, cam.recorder.password, signal)
        return { bytes, via: 'onvif' }
      }
    } catch (e) {
      // 失敗はキャッシュを捨てて go2rtc へフォールバック
      onvifUriCache.delete(cam.id)
      logger.warn({ cam_id: cam.id, err: String(e) }, 'capture: onvif snapshot failed → go2rtc fallback')
    }
  }

  // 3. go2rtc 現フレーム（フォールバック。onvif-generic / live_rtsp override）
  if (cam.recorder.vendor === 'onvif-generic' || cam.live_rtsp) {
    const r = await fetch(`${config.GO2RTC_API}/api/frame.jpeg?src=${go2rtcStreamName(cam.id)}`, { signal })
    if (!r.ok) throw new Error(`go2rtc frame ${r.status}`)
    return { bytes: await r.arrayBuffer(), via: 'go2rtc' }
  }

  throw new Error(`no snapshot source for vendor ${cam.recorder.vendor}`)
}
