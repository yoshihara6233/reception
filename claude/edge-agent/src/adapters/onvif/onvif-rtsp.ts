/**
 * ONVIF カメラの RTSP ライブ URL を解決する小ヘルパ。
 *
 * i-PRO カメラの RTSP パスは profile token を含む動的 URL
 * (例: rtsp://<ip>/ONVIF/MediaInput?profile=def_profile1) なので、
 * 静的に組まず ONVIF Media GetProfiles → GetStreamUri で取得する
 * (2026-06-19 実機スパイクで確認)。
 */
import { OnvifSoapClient } from './onvif-soap-client'

export interface OnvifRtspOptions {
  endpoint:   string   // 'http://192.168.0.101' (ONVIF device/media service の base)
  username:   string
  password:   string
  timeoutMs?: number
}

/**
 * channel (1-based) に対応する RTSP URL を返す。資格情報は含まない
 * (ffmpeg 用には injectRtspCreds で付与する)。
 */
export async function resolveOnvifRtspUrl(
  opts:    OnvifRtspOptions,
  channel: number,
  client?: OnvifSoapClient,
): Promise<string> {
  const c = client ?? new OnvifSoapClient(opts)
  const profiles = await c.getProfiles()
  const profile = profiles[channel - 1] ?? profiles[0]
  if (!profile) {
    throw new Error(`ONVIF: no media profiles at ${opts.endpoint}`)
  }
  return c.getStreamUri(profile.token, 'RTSP')
}
