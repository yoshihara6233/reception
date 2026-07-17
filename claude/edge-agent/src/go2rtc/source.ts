/**
 * go2rtc ソース文字列の純ロジック（config/logger 非依存＝単体テスト可能）。
 *
 * 2026-07-17 実障害（WV-SW158 高画質が全HTTP 200なのに真っ黒）の教訓:
 *   1. 素通し(passthrough)でも音声トラックは必ず落とす。ONVIF カメラの音声
 *      (PCM A-law / μ-law 等)は fMP4/MSE で扱えず、映像が H.264 でも
 *      ブラウザが復号を止めて無音の黒画面になる。`#media=video` で映像のみ通す。
 *   2. コーデック判定不能（ffprobe 失敗・タイムアウト）は「素通し」ではなく
 *      「変換」に倒す。H.265 を素通しした時の障害（黒画面）は HTTP が全部 200 の
 *      まま起きるので発見が遅れる。変換の無駄（H.264→H.264）は VAAPI なら軽微。
 */

export interface SourceOptions {
  ffmpegBin:   string
  /** VAAPI レンダーデバイス（空文字ならソフトウェア変換にフォールバック）。 */
  vaapiDevice: string
}

/**
 * go2rtc の source 文字列を決める。
 *   - h264 確定 → 素通し（ただし音声は落とす: `#media=video`）
 *   - それ以外（hevc / h265 / 不明 / その他）→ H.264 変換（音声除去 `-an` 込み）
 */
export function buildSource(rtsp: string, codec: string | null, opts: SourceOptions): string {
  if (codec === 'h264') return `${rtsp}#media=video`
  const dev = opts.vaapiDevice.trim()
  if (dev) {
    return `exec:${opts.ffmpegBin} -hide_banner -loglevel error`
      + ` -init_hw_device vaapi=va:${dev} -hwaccel vaapi -hwaccel_device va -hwaccel_output_format vaapi`
      + ` -rtsp_transport tcp -i ${rtsp} -an -c:v h264_vaapi -g 30 -bf 0`
      + ` -f rtsp -rtsp_transport tcp {output}`
  }
  return `ffmpeg:${rtsp}#video=h264`   // ソフト変換フォールバック
}
