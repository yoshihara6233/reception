/**
 * DB 由来の go2rtc 設定自動生成（多店舗・多カメラ対応）。
 *
 * 手動 go2rtc.yaml 編集を撤廃し、エッジが担当カメラから go2rtc.yaml を生成して
 * 書き出す。ストリーム名は `cam_<cameraId>`（monitor 側も同じ規則で参照）。
 *
 * なぜ API でなくファイル生成か:
 *   go2rtc は REST API 経由で `exec:`/`ffmpeg:`（プロセス起動を伴う source）の
 *   登録を拒否する（"source from insecure producer"）。H.265→H.264 変換は exec が
 *   必須なので、設定ファイルに書く以外に方法がない。passthrough(rtsp) も含め
 *   ファイル生成で統一する。
 *
 * ソース決定:
 *   - `recorder_cameras.live_rtsp`（完全URL or パスのみ）から RTSP を組み立て、
 *     recorders の username/password を注入。
 *   - ffprobe でコーデック判定し、H.265(HEVC) のみ VAAPI で H.264 に変換
 *     （`exec:ffmpeg ... h264_vaapi ... {output}`）。H.264 は素通し。
 *
 * 反映:
 *   生成内容が現行ファイルと異なる時だけ書き出し、go2rtc サービスを再起動する
 *   （`sudo systemctl restart <GO2RTC_SERVICE>`・要 NOPASSWD sudoers）。無変更時は
 *   何もしない（視聴を切らない）。go2rtc は consumer 接続時に source 起動＝
 *   オンデマンド（無視聴時はエンコードは走らない）。
 */
import { spawn } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
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

/** RTSP の映像コーデックを ffprobe で判定（hevc / h264 / null）。結果はキャッシュ。 */
const codecCache = new Map<string, string | null>()
async function probeCodec(rtsp: string): Promise<string | null> {
  if (codecCache.has(rtsp)) return codecCache.get(rtsp)!
  const codec = await new Promise<string | null>((resolve) => {
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
  if (codec) codecCache.set(rtsp, codec)   // 失敗(null)はキャッシュしない=次回再試行
  return codec
}

/** go2rtc の source 文字列を決める（H.265→H.264変換 or 素通し）。 */
function buildSource(rtsp: string, codec: string | null): string {
  const isHevc = codec === 'hevc' || codec === 'h265'
  if (!isHevc) return rtsp   // H.264 等は素通し（変換不要）
  const dev = config.GO2RTC_VAAPI_DEVICE.trim()
  if (dev) {
    return `exec:${config.FFMPEG_BIN} -hide_banner -loglevel error`
      + ` -init_hw_device vaapi=va:${dev} -hwaccel vaapi -hwaccel_device va -hwaccel_output_format vaapi`
      + ` -rtsp_transport tcp -i ${rtsp} -an -c:v h264_vaapi -g 30 -bf 0`
      + ` -f rtsp -rtsp_transport tcp {output}`
  }
  return `ffmpeg:${rtsp}#video=h264`   // ソフト変換フォールバック
}

/** YAML 値として安全に二重引用符でくくる。 */
function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** 担当カメラから go2rtc.yaml の内容を生成する。 */
async function buildYaml(cameras: CameraDescriptor[]): Promise<string> {
  const lines = [
    'log:',
    '  level: info',
    'rtsp:',
    `  listen: "${config.GO2RTC_RTSP_LISTEN}"`,
    'ffmpeg:',
    `  bin: ${config.FFMPEG_BIN}`,
    'streams:',
  ]
  for (const cam of cameras) {
    const rtsp  = buildRtspUrl(cam)
    const codec = await probeCodec(rtsp)
    const src   = buildSource(rtsp, codec)
    lines.push(`  ${go2rtcStreamName(cam.id)}: ${yamlQuote(src)}`)
    logger.info({ name: go2rtcStreamName(cam.id), codec, hw: src.startsWith('exec:') }, 'go2rtc: stream planned')
  }
  return lines.join('\n') + '\n'
}

/** go2rtc サービスを再起動（NOPASSWD sudoers 前提）。 */
async function restartGo2rtc(): Promise<void> {
  await new Promise<void>((resolve) => {
    const proc = spawn('sudo', ['systemctl', 'restart', config.GO2RTC_SERVICE], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    proc.stderr?.on('data', (b: Buffer) => { err += b.toString() })
    proc.on('error', (e) => { logger.warn({ err: String(e) }, 'go2rtc: restart spawn failed'); resolve() })
    proc.on('exit', (code) => {
      if (code === 0) logger.info('go2rtc: restarted (config changed)')
      else logger.warn({ code, err: err.slice(0, 200) }, 'go2rtc: restart non-zero (sudoers?)')
      resolve()
    })
  })
}

/**
 * 担当カメラ（live_rtsp 設定済み）から go2rtc.yaml を生成し、変更時のみ反映。
 * targets が 0 の時は何もしない（DB一時障害で設定を消さないため）。
 */
export async function syncGo2rtcStreams(cameras: CameraDescriptor[]): Promise<void> {
  const targets = cameras.filter((c) => !!c.live_rtsp)
  if (targets.length === 0) return
  const yaml = await buildYaml(targets)
  const current = await readFile(config.GO2RTC_CONFIG, 'utf8').catch(() => '')
  if (yaml === current) { logger.info({ streams: targets.length }, 'go2rtc: config unchanged'); return }
  await writeFile(config.GO2RTC_CONFIG, yaml, 'utf8')
  logger.info({ streams: targets.length, path: config.GO2RTC_CONFIG }, 'go2rtc: config written')
  await restartGo2rtc()
}

let syncTimer: ReturnType<typeof setInterval> | null = null

/** 起動時同期 + 定期再同期を開始（DB変更/サービス状態に追従）。 */
export function startGo2rtcSync(loadCameras: () => Promise<CameraDescriptor[]>): void {
  const run = () => {
    loadCameras()
      .then((cams) => syncGo2rtcStreams(cams))
      .catch((e) => logger.warn({ err: String(e) }, 'go2rtc: periodic sync failed'))
  }
  run()
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = setInterval(run, config.GO2RTC_SYNC_INTERVAL_MS)
}
