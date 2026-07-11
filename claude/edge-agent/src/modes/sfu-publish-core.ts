/**
 * SFU publish の純ロジック（config/logger 非依存＝単体テスト可能）。
 * 実行部（ffmpeg spawn）は sfu-publish.ts。
 *
 * transport は **WHIP**（LiveKit ネイティブの WebRTC-HTTP Ingestion）。
 *   - エッジには WHIP muxer 対応 ffmpeg（BtbN ビルド等・7.1+）を配置する。johnvansickle 静的
 *     ビルドは WHIP 非対応なので不可（"output format 'whip' is not known" になる）。
 *   - WHIP 先は whip-proxy 経由で渡す（ffmpeg WHIP muxer が SDP の TCP ICE 候補で失敗する
 *     既知問題を回避・whip-proxy.ts）。
 * codec は **無変換 `-c:v copy`**。go2rtc が RTSP で H.264 を配信済み（H.265 カメラも go2rtc が
 *   変換）＝再エンコード不要で最低遅延・最低CPU。
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
 * ffmpeg 引数（go2rtc RTSP → 無変換 → WHIP publish）。
 * `-fflags +genpts` は go2rtc の非単調DTS対策。音声なし（監視用途）。
 */
export function buildSfuFfmpegArgs(src: string, whipTarget: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-rtsp_transport', 'tcp',
    '-fflags', '+genpts',
    '-i', src,
    '-an',                     // 音声なし
    '-c:v', 'copy',            // go2rtc が H.264 配信済み → 再エンコードしない
    '-f', 'whip', whipTarget,
  ]
}
