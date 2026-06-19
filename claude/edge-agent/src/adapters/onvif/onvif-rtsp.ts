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
 * grid (静止画合成) 用の RTSP URL を返す。資格情報は含まない
 * (ffmpeg 用には injectRtspCreds で付与する)。
 *
 * プロファイル選択方針 (2026-06-19 実機 102 の知見):
 *   メインの H264/H265 ストリームは NVR が掴んでいて SETUP=503 になりがち。
 *   一方 **JPEG/MJPEG プロファイルは別枠で空いている**ことが多く、grid の静止画には最適。
 *   → JPEG/MJPEG プロファイルがあれば最優先。無ければ channel 対応 (なければ先頭)。
 */
export async function resolveOnvifRtspUrl(
  opts:    OnvifRtspOptions,
  channel: number,
  client?: OnvifSoapClient,
): Promise<string> {
  const c = client ?? new OnvifSoapClient(opts)
  const profiles = await c.getProfiles()
  if (profiles.length === 0) {
    throw new Error(`ONVIF: no media profiles at ${opts.endpoint}`)
  }
  const jpeg = profiles.find((p) => /jpe?g|mjpeg/i.test(p.encoding ?? ''))
  const profile = jpeg ?? profiles[channel - 1] ?? profiles[0]
  return c.getStreamUri(profile.token, 'RTSP')
}
