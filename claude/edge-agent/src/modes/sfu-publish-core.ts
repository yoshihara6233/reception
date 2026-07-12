/**
 * SFU publish の純ロジック（config/logger 非依存＝単体テスト可能）。
 * 実行部（ffmpeg spawn）は sfu-publish.ts。
 *
 * transport は **WHIP**（LiveKit ネイティブの WebRTC-HTTP Ingestion）。
 *   - エッジには WHIP muxer 対応 ffmpeg（BtbN ビルド等・7.1+）を配置する。johnvansickle 静的
 *     ビルドは WHIP 非対応なので不可（"output format 'whip' is not known" になる）。
 *   - WHIP 先は whip-proxy 経由で渡す（ffmpeg WHIP muxer が SDP の TCP ICE 候補で失敗する
 *     既知問題を回避・whip-proxy.ts）。
 * codec は **H.264 constrained baseline へ変換**。WHIP(WebRTC)ingress は素通し（RTMPと違い
 *   transcode しない）ため、ブラウザ互換 profile が必須。go2rtc ソースは High profile なので
 *   `-c copy` だと復号されず「配信待ち→黒画面」になる。baseline+yuv420p で確実に再生される。
 *   （変換は libx264 ultrafast・1080p10fpsで低負荷。映れば VAAPI 最適化も可）
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
 * ffmpeg 引数（go2rtc RTSP → 720p baseline H.264 変換 → WHIP publish）。
 *
 * WHIP muxer の "UDP send blocked" 対策:
 *   - `-ts_buffer_size` を拡大（muxer 自身の推奨。UDP送信バッファ溢れ EAGAIN を回避）。
 *   - 720p ダウンスケール＋ビットレート上限で I-frame バーストを縮小（監視用途に十分）。
 * `-fflags +genpts` は go2rtc の非単調DTS対策。音声なし。
 */
export function buildSfuFfmpegArgs(src: string, whipTarget: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-rtsp_transport', 'tcp',
    '-fflags', '+genpts',
    '-i', src,
    '-an',                          // 音声なし
    '-vf', 'scale=1280:720',        // 720p へ縮小（バースト縮小・監視に十分）
    '-c:v', 'libx264',
    '-profile:v', 'baseline',       // WebRTC/ブラウザ互換（High は WHIP 素通しで再生不可）
    '-pix_fmt', 'yuv420p',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-b:v', '2000k', '-maxrate', '2500k', '-bufsize', '3000k',
    '-g', '30',
    '-ts_buffer_size', '8000000',   // WHIP UDP送信バッファ拡大（muxer 推奨・EAGAIN回避）
    '-f', 'whip', whipTarget,
  ]
}

/**
 * VAAPI 版 ffmpeg 引数（GPUデコード → scale_vaapi → h264_vaapi encode → WHIP）。
 *
 * libx264 ultrafast の CPU 負荷を GPU へ逃がす（go2rtc の H.265→H.264 変換も同じ
 * VAAPI デバイスで実績あり）。WebRTC 互換の要件は libx264 版と同じ:
 *   - `-profile:v constrained_baseline`（High はブラウザで再生不可）
 *   - `-bf 0`（h264_vaapi は既定で B-frame を入れるが WebRTC は B-frame 不可）
 * ドライバが constrained_baseline 非対応の個体もあるため、実行側（sfu-publish.ts）は
 * 早期異常終了を検知して libx264 へ自動フォールバックする。
 */
export function buildSfuFfmpegArgsVaapi(src: string, whipTarget: string, device: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'warning',
    '-rtsp_transport', 'tcp',
    '-fflags', '+genpts',
    // 入力オプション: GPU デコード（出力も VAAPI サーフェスのまま scale/encode へ渡す）
    '-hwaccel', 'vaapi',
    '-hwaccel_device', device,
    '-hwaccel_output_format', 'vaapi',
    '-i', src,
    '-an',
    '-vf', 'scale_vaapi=w=1280:h=720',   // GPU 上で 720p 縮小（CPU コピー往復なし）
    '-c:v', 'h264_vaapi',
    '-profile:v', 'constrained_baseline',
    '-bf', '0',                          // WebRTC は B-frame 不可（h264_vaapi 既定は bf>0）
    '-b:v', '2000k', '-maxrate', '2500k', '-bufsize', '3000k',
    '-g', '30',
    '-ts_buffer_size', '8000000',
    '-f', 'whip', whipTarget,
  ]
}
