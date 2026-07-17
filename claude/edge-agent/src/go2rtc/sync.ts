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
import { OnvifSoapClient } from '../adapters/onvif/onvif-soap-client.js'
import { buildSource, extractForeignStreamLines, sortStreamLines } from './source.js'
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

/**
 * カメラの go2rtc ソース（RTSP + codec）を解決する。
 *   1. live_rtsp が明示されていればそれを使う（override）。
 *   2. onvif-generic は ONVIF GetProfiles→GetStreamUri で自動解決（完全ゼロ設定）。
 *      NVR が片方の主ストリームを掴んで 503 になることがあるため、映像プロファイルを
 *      順に ffprobe し、最初に流れるものを採用。成功はキャッシュ（失敗は再試行）。
 */
const resolvedCache = new Map<string, { rtsp: string; codec: string | null }>()
async function resolveCameraSource(cam: CameraDescriptor): Promise<{ rtsp: string; codec: string | null } | null> {
  if (cam.live_rtsp) {
    const rtsp = buildRtspUrl(cam)
    return { rtsp, codec: await probeCodec(rtsp) }
  }
  if (cam.recorder.vendor !== 'onvif-generic') return null
  const cached = resolvedCache.get(cam.id)
  if (cached) return cached
  const r = cam.recorder
  const endpoint = `http://${r.host}:${r.onvif_port ?? 80}`
  try {
    const client = new OnvifSoapClient({ endpoint, username: r.username, password: r.password, timeoutMs: 8_000 })
    const profiles = await client.getProfiles()
    const video = profiles.filter((p) => /h\.?26[45]|hevc/i.test(p.encoding ?? ''))
    for (const p of (video.length ? video : profiles)) {
      const uri  = await client.getStreamUri(p.token)
      const rtsp = injectRtspCreds(uri, r.username, r.password)
      const codec = await probeCodec(rtsp)
      if (codec) {
        const resolved = { rtsp, codec }
        resolvedCache.set(cam.id, resolved)
        logger.info({ camera_id: cam.id, profile: p.name, codec }, 'go2rtc: ONVIF auto-resolved live RTSP')
        return resolved
      }
    }
    logger.warn({ camera_id: cam.id }, 'go2rtc: ONVIF found no streamable video profile')
    return null
  } catch (e) {
    logger.warn({ camera_id: cam.id, err: String(e) }, 'go2rtc: ONVIF resolve failed')
    return null
  }
}

// source 文字列の決定は純ロジック側（./source.ts）に集約。
// h264 確定のみ素通し（音声は #media=video で除去）、hevc/判定不能は VAAPI 変換。
// 経緯は source.ts 冒頭コメント（2026-07-17 実障害）を参照。

/** YAML 値として安全に二重引用符でくくる。 */
function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * 担当カメラ＋既存設定から go2rtc.yaml の内容を生成する。
 *
 * 自分の担当カメラは毎回再生成（DBから消えた/解決不能な担当カメラは落ちる）。
 * **担当外の `cam_*` 行は原文のまま保持**する — 1箱に複数エージェントが同居する
 * PoC 構成（intereco-edge / intereco-edge-demo）や手動登録を消さないため
 * （2026-07-17 実障害）。全ストリーム行は名前順ソートで決定的にし、複数書き手の
 * 書き込みピンポン（互いに差分ありと判定→restartの往復）を防ぐ。
 * 返り値 count は自分の担当分の数（0 なら呼び出し側で書き込みを抑止）。
 */
async function buildYaml(cameras: CameraDescriptor[], currentYaml: string): Promise<{ yaml: string; count: number }> {
  const header = [
    'log:',
    '  level: info',
    'rtsp:',
    `  listen: "${config.GO2RTC_RTSP_LISTEN}"`,
    'ffmpeg:',
    `  bin: ${config.FFMPEG_BIN}`,
    'streams:',
  ]
  const ownNames = new Set<string>()
  const streamLines: string[] = []
  let count = 0
  for (const cam of cameras) {
    const resolved = await resolveCameraSource(cam)
    if (!resolved) continue   // 解決できないカメラは設定に含めない
    const src = buildSource(resolved.rtsp, resolved.codec, {
      ffmpegBin: config.FFMPEG_BIN, vaapiDevice: config.GO2RTC_VAAPI_DEVICE,
    })
    const name = go2rtcStreamName(cam.id)
    ownNames.add(name)
    streamLines.push(`  ${name}: ${yamlQuote(src)}`)
    count++
    logger.info({ name, codec: resolved.codec, hw: src.startsWith('exec:') }, 'go2rtc: stream planned')
  }
  const foreign = extractForeignStreamLines(currentYaml, ownNames)
  if (foreign.length > 0) {
    logger.info({ preserved: foreign.length }, 'go2rtc: preserving streams not owned by this agent')
  }
  const lines = [...header, ...sortStreamLines([...streamLines, ...foreign])]
  return { yaml: lines.join('\n') + '\n', count }
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
 * go2rtc 対象カメラ（onvif-generic=ONVIF自動解決 / または live_rtsp 明示）から
 * go2rtc.yaml を生成し、変更時のみ反映。解決0件の時は書き換えない
 * （DB一時障害や全カメラONVIF不通で設定を消さないため）。
 */
export async function syncGo2rtcStreams(cameras: CameraDescriptor[]): Promise<void> {
  const targets = cameras.filter((c) => c.recorder.vendor === 'onvif-generic' || !!c.live_rtsp)
  if (targets.length === 0) return
  const current = await readFile(config.GO2RTC_CONFIG, 'utf8').catch(() => '')
  const { yaml, count } = await buildYaml(targets, current)
  if (count === 0) { logger.warn('go2rtc: no streamable cameras resolved; keeping current config'); return }
  if (yaml === current) { logger.info({ streams: count }, 'go2rtc: config unchanged'); return }
  await writeFile(config.GO2RTC_CONFIG, yaml, 'utf8')
  logger.info({ streams: count, path: config.GO2RTC_CONFIG }, 'go2rtc: config written')
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
