/**
 * DB 由来の go2rtc ストリーム自動登録（多店舗・多カメラ対応）。
 *
 * 手動 go2rtc.yaml 編集を撤廃し、エッジが担当カメラの go2rtc ストリームを
 * go2rtc REST API (`PUT /api/streams`) で登録する。ストリーム名は
 * `cam_<cameraId>`（monitor 側も同じ規則で参照）。
 *
 * ソース決定:
 *   - `recorder_cameras.live_rtsp`（完全URL or パスのみ）から RTSP を組み立て、
 *     recorders の username/password を注入。
 *   - ffprobe でコーデック判定し、H.265(HEVC) のみ VAAPI で H.264 に変換
 *     （`exec:ffmpeg ... h264_vaapi ... {output}`）。H.264 は素通し。
 *     VAAPI デバイス未設定時はソフト変換にフォールバック。
 *
 * go2rtc は consumer 接続時に初めて source を起動する（オンデマンド）。本同期は
 * ストリーム"定義"を登録するだけで、無視聴時はエンコードは走らない。
 */
import { spawn } from 'node:child_process'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { injectRtspCreds } from '../rtsp/keyframe.js'
import type { CameraDescriptor } from '../types.js'

/** go2rtc ストリーム名（monitor 側 `src=cam_<id>` と一致させる）。 */
export function go2rtcStreamName(cameraId: string): string {
  return `cam_${cameraId}`
}

/** live_rtsp（完全URL or パスのみ）から、認証付き RTSP URL を組み立てる。 */
function buildRtspUrl(cam: CameraDescriptor): string {
  const r = cam.recorder
  const raw = (cam.live_rtsp ?? '').trim()
  const full = /^rtsps?:\/\//i.test(raw)
    ? raw
    : `rtsp://${r.host}:${r.rtsp_port || 554}/${raw.replace(/^\/+/, '')}`
  return injectRtspCreds(full, r.username, r.password)
}

/** RTSP の映像コーデックを ffprobe で判定（hevc / h264 / null）。 */
async function probeCodec(rtsp: string): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn(config.FFPROBE_BIN, [
      '-v', 'error', '-rtsp_transport', 'tcp',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=nw=1:nk=1',
      rtsp,
    ], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    proc.stdout?.on('data', (b: Buffer) => { out += b.toString() })
    proc.on('error', () => resolve(null))
    proc.on('exit', () => resolve(out.trim().split(/\s+/)[0] || null))
  })
}

/** go2rtc に渡す source 文字列を決める（H.265→H.264変換 or 素通し）。 */
function buildSource(rtsp: string, codec: string | null): string {
  const isHevc = codec === 'hevc' || codec === 'h265'
  if (!isHevc) return rtsp   // H.264 等は素通し（変換不要）
  const dev = config.GO2RTC_VAAPI_DEVICE.trim()
  if (dev) {
    // VAAPI ハードウェア変換（HEVCデコード→GPUでH.264エンコード）
    return `exec:${config.FFMPEG_BIN} -hide_banner -loglevel error`
      + ` -init_hw_device vaapi=va:${dev} -hwaccel vaapi -hwaccel_device va -hwaccel_output_format vaapi`
      + ` -rtsp_transport tcp -i ${rtsp} -an -c:v h264_vaapi -g 30 -bf 0`
      + ` -f rtsp -rtsp_transport tcp {output}`
  }
  // ソフト変換フォールバック
  return `ffmpeg:${rtsp}#video=h264`
}

/** go2rtc に1ストリームを登録（PUT /api/streams）。 */
async function putStream(name: string, src: string): Promise<boolean> {
  const url = `${config.GO2RTC_API}/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(src)}`
  try {
    const res = await fetch(url, { method: 'PUT', signal: AbortSignal.timeout(8_000) })
    if (!res.ok) { logger.warn({ name, status: res.status }, 'go2rtc: putStream non-OK'); return false }
    return true
  } catch (e) {
    logger.warn({ name, err: String(e) }, 'go2rtc: putStream failed')
    return false
  }
}

/**
 * 担当カメラ（live_rtsp 設定済み）の go2rtc ストリームを登録する。
 * 1回分。失敗カメラはスキップ（他に影響させない）。
 */
export async function syncGo2rtcStreams(cameras: CameraDescriptor[]): Promise<void> {
  const targets = cameras.filter((c) => !!c.live_rtsp)
  if (targets.length === 0) return
  let ok = 0
  for (const cam of targets) {
    try {
      const rtsp  = buildRtspUrl(cam)
      const codec = await probeCodec(rtsp)
      const src   = buildSource(rtsp, codec)
      const name  = go2rtcStreamName(cam.id)
      if (await putStream(name, src)) {
        ok++
        logger.info({ name, codec, hw: src.startsWith('exec:') }, 'go2rtc: stream registered')
      }
    } catch (e) {
      logger.warn({ camera_id: cam.id, err: String(e) }, 'go2rtc: sync camera failed')
    }
  }
  logger.info({ registered: ok, total: targets.length }, 'go2rtc: sync done')
}

let syncTimer: ReturnType<typeof setInterval> | null = null

/**
 * 起動時同期 + 定期再同期を開始。go2rtc 再起動でも streams を取り戻す。
 * loadCameras は呼び出し側から渡す（cameras.ts への依存を避ける）。
 */
export function startGo2rtcSync(loadCameras: () => Promise<CameraDescriptor[]>): void {
  const run = () => {
    loadCameras()
      .then((cams) => syncGo2rtcStreams(cams))
      .catch((e) => logger.warn({ err: String(e) }, 'go2rtc: periodic sync failed'))
  }
  run()   // 起動時
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = setInterval(run, config.GO2RTC_SYNC_INTERVAL_MS)
}
