/**
 * SFU publish の純ロジック（config/logger 非依存＝単体テスト可能）。
 * 実行部（ffmpeg spawn）は sfu-publish.ts。
 *
 * transport は **RTMP**（LiveKit RTMP Ingress）。理由:
 *   - ffmpeg の WHIP muxer は 7.1+ 限定で、現地エッジの ffmpeg には無い
 *     （"Requested output format 'whip' is not known"）。RTMP/FLV 出力は全ビルドに存在。
 * codec は **H.264 へ変換**（libx264）。WebRTC/LiveKit は H.264 必須で、i-PRO 等の
 *   H.265 カメラは go2rtc RTSP でも hevc のまま来るため、ここで確実に H.264 化する。
 */

/**
 * go2rtc 内部RTSP の ストリームURL。ストリーム名は monitor の hqUrl と同規則 `cam_<id>`。
 * listen は ":18554" 形式（host 省略時は 127.0.0.1）。
 */
export function go2rtcRtspUrl(cameraId: string, listen: string): string {
  const hostPort = listen.startsWith(':') ? `127.0.0.1${listen}` : listen
  return `rtsp://${hostPort}/cam_${cameraId}`
}

/**
 * ffmpeg 引数（go2rtc RTSP → H.264 変換 → RTMP publish）。
 * `-tune zerolatency` と短い GOP で低遅延化。音声なし（監視用途）。
 */
export function buildSfuFfmpegArgs(src: string, publishUrl: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-rtsp_transport', 'tcp',
    '-fflags', '+genpts',      // go2rtc の非単調DTS対策
    '-i', src,
    '-an',                     // 音声なし
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',     // WebRTC/ブラウザ互換
    '-g', '30',                // キーフレーム間隔（低遅延・再接続容易）
    '-f', 'flv', publishUrl,   // RTMP(FLV) 出力
  ]
}
