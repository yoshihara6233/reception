/**
 * SFU publish の純ロジック（config/logger 非依存＝単体テスト可能）。
 * 実行部（ffmpeg spawn）は sfu-publish.ts。
 */

/**
 * go2rtc 内部RTSP の H.264 ストリームURL。ストリーム名は monitor の hqUrl と同規則 `cam_<id>`。
 * listen は ":18554" 形式（host 省略時は 127.0.0.1）。
 */
export function go2rtcRtspUrl(cameraId: string, listen: string): string {
  const hostPort = listen.startsWith(':') ? `127.0.0.1${listen}` : listen
  return `rtsp://${hostPort}/cam_${cameraId}`
}

/**
 * ffmpeg 引数（go2rtc H.264 RTSP → WHIP・再エンコードなし）。
 * `-fflags +genpts` は go2rtc の非単調DTS対策。`-c:v copy` で VAAPI 調整不要。
 */
export function buildSfuFfmpegArgs(src: string, target: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-rtsp_transport', 'tcp',
    '-fflags', '+genpts',
    '-i', src,
    '-an',
    '-c:v', 'copy',
    '-f', 'whip', target,
  ]
}
