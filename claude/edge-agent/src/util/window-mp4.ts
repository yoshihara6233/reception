/**
 * 録画ウィンドウ MP4 の取得・変換ユーティリティ（VOD と 手荷物検査クリップで共有）
 *
 * ソース別:
 *   - Frigate:   clip.mp4（fragmented MP4）を取得 → faststart へ remux
 *   - i-PRO NVR: httpdl.cgi で標準MP4を取得（remux不要）
 * 変換:
 *   - HEVC(H.265) の録画は Chrome/Firefox 再生不可 → H.264 へ変換
 *   - Frigate の fragmented+非単調DTS は libx264 再エンコードで修復（-c copy では直らない）
 *
 * ここは vod.ts と clip-jobs ワーカの両方から使う。ffprobe による尺計測も提供する。
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { downloadIproNvrMp4 } from '../adapters/i-pro/nvr-vod.js'
import type { CameraDescriptor } from '../types.js'

const WORK_DIR = join(tmpdir(), 'intereco-edge-window')

// ffmpeg/ffprobe が異常入力でハングした場合の上限。超過で SIGKILL（ワーカの busy が
// 永久に解放されず全クリップ処理が止まる事故の防止）。
const FFMPEG_KILL_MS = 5 * 60 * 1000
const FFPROBE_KILL_MS = 30 * 1000

/** spawn したプロセスに kill タイマーを付け、exit で解除するヘルパ。 */
function armKillTimer(proc: import('node:child_process').ChildProcess, ms: number): void {
  const t = setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* already dead */ } }, ms)
  proc.on('exit', () => clearTimeout(t))
}

/**
 * Frigate clip.mp4 を faststart MP4 へ remux（libx264 再エンコード）。
 * Frigate の fragmented MP4 + 非単調DTS は copy では直らないため再エンコードする。
 */
export async function remuxFaststart(input: Buffer, id: string): Promise<Buffer> {
  await mkdir(WORK_DIR, { recursive: true })
  const inPath = join(WORK_DIR, `${id}.in.mp4`)
  const outPath = join(WORK_DIR, `${id}.out.mp4`)
  try {
    await writeFile(inPath, input)
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(config.FFMPEG_BIN, [
        '-hide_banner', '-loglevel', 'warning',
        '-i', inPath,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
        '-profile:v', 'main', '-pix_fmt', 'yuv420p',
        '-c:a', 'copy',
        '-movflags', '+faststart', '-f', 'mp4', '-y', outPath,
      ], { stdio: ['ignore', 'pipe', 'pipe'] })
      armKillTimer(proc, FFMPEG_KILL_MS)
      let stderr = ''
      proc.stderr?.on('data', (b: Buffer) => { stderr += b.toString() })
      proc.on('error', reject)
      proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg remux exit ${code}: ${stderr.slice(0, 300)}`)))
    })
    return await readFile(outPath)
  } finally {
    await unlink(inPath).catch(() => {})
    await unlink(outPath).catch(() => {})
  }
}

/** 動画コーデック名を ffprobe で判定（判定不能は null）。 */
export async function probeVideoCodec(path: string): Promise<string | null> {
  try {
    return await new Promise<string | null>((resolve) => {
      const proc = spawn(config.FFPROBE_BIN, [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name', '-of', 'default=nw=1:nk=1', path,
      ], { stdio: ['ignore', 'pipe', 'pipe'] })
      armKillTimer(proc, FFPROBE_KILL_MS)
      let out = ''
      proc.stdout?.on('data', (b: Buffer) => { out += b.toString() })
      proc.on('error', () => resolve(null))
      proc.on('exit', () => resolve(out.trim().split(/\s+/)[0] || null))
    })
  } catch {
    return null
  }
}

/** MP4 の尺（秒）を ffprobe で計測（判定不能は null）。 */
export async function probeDurationSec(buf: Buffer, id: string): Promise<number | null> {
  await mkdir(WORK_DIR, { recursive: true })
  const p = join(WORK_DIR, `${id}.probe.mp4`)
  try {
    await writeFile(p, buf)
    return await new Promise<number | null>((resolve) => {
      const proc = spawn(config.FFPROBE_BIN, [
        '-v', 'error', '-show_entries', 'format=duration',
        '-of', 'default=nw=1:nk=1', p,
      ], { stdio: ['ignore', 'pipe', 'pipe'] })
      armKillTimer(proc, FFPROBE_KILL_MS)
      let out = ''
      proc.stdout?.on('data', (b: Buffer) => { out += b.toString() })
      proc.on('error', () => resolve(null))
      proc.on('exit', () => {
        const n = Number(out.trim())
        resolve(Number.isFinite(n) && n > 0 ? n : null)
      })
    })
  } finally {
    await unlink(p).catch(() => {})
  }
}

/** HEVC(H.265) のみ H.264 へ変換。H.264 等・判定不能はそのまま返す（世代劣化回避）。 */
export async function transcodeHevcToH264IfNeeded(input: Buffer, id: string): Promise<Buffer> {
  await mkdir(WORK_DIR, { recursive: true })
  const inPath = join(WORK_DIR, `${id}.src.mp4`)
  const outPath = join(WORK_DIR, `${id}.h264.mp4`)
  try {
    await writeFile(inPath, input)
    const codec = await probeVideoCodec(inPath)
    if (codec !== 'hevc' && codec !== 'h265') {
      logger.info({ id, codec }, 'window-mp4: no transcode (already browser-playable)')
      return input
    }
    logger.info({ id, codec }, 'window-mp4: HEVC detected → transcoding to H.264')
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(config.FFMPEG_BIN, [
        '-hide_banner', '-loglevel', 'warning',
        '-i', inPath,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
        '-profile:v', 'main', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k',
        '-movflags', '+faststart', '-f', 'mp4', '-y', outPath,
      ], { stdio: ['ignore', 'pipe', 'pipe'] })
      armKillTimer(proc, FFMPEG_KILL_MS)
      let stderr = ''
      proc.stderr?.on('data', (b: Buffer) => { stderr += b.toString() })
      proc.on('error', reject)
      proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg hevc→h264 exit ${code}: ${stderr.slice(0, 300)}`)))
    })
    return await readFile(outPath)
  } finally {
    await unlink(inPath).catch(() => {})
    await unlink(outPath).catch(() => {})
  }
}

/** i-PRO NVR httpdl で VOD 取得できる構成か。 */
export function supportsWindowMp4(camera: CameraDescriptor): boolean {
  const rec = camera.recorder
  return rec.vendor === 'frigate'
    || rec.vendor === 'i-pro-nvr'
    || (rec.vendor === 'onvif-generic' && !!rec.vod_host)
}

/**
 * カメラの録画から [fromIso, toIso] のウィンドウ MP4 を取得し、ブラウザ再生可能な
 * H.264 faststart にして返す。id はテンポラリファイル名の一意化用。
 */
export async function fetchWindowMp4(
  camera: CameraDescriptor,
  fromIso: string,
  toIso: string,
  id: string,
): Promise<Buffer> {
  const rec = camera.recorder
  const isOnvifNvrVod = rec.vendor === 'onvif-generic' && !!rec.vod_host
  const isNvrVod = rec.vendor === 'i-pro-nvr'

  if (rec.vendor === 'frigate') {
    const frigateCam = camera.frigate_camera
    if (!frigateCam) throw new Error(`camera ${camera.id} has no frigate_camera mapping`)
    const startSec = Math.floor(Date.parse(fromIso) / 1000)
    const endSec = Math.floor(Date.parse(toIso) / 1000)
    const src = `http://${rec.host}:${config.FRIGATE_API_PORT}/api/${frigateCam}/start/${startSec}/end/${endSec}/clip.mp4`
    const r = await fetch(src, { signal: AbortSignal.timeout(120_000) })
    if (!r.ok) throw new Error(`frigate ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
    const raw = Buffer.from(await r.arrayBuffer())
    if (raw.length < 1024) throw new Error(`empty_clip (bytes=${raw.length})`)
    return await remuxFaststart(raw, id)
  }

  if (isOnvifNvrVod || isNvrVod) {
    const endpoint = isNvrVod
      ? (rec.host.startsWith('http') ? rec.host : `https://${rec.host}`)
      : rec.vod_host!
    const user = isNvrVod ? rec.username : (rec.vod_username ?? rec.username)
    const pass = isNvrVod ? rec.password : (rec.vod_password ?? rec.password)
    const channel = isNvrVod ? camera.channel : (rec.vod_channel ?? camera.channel)
    const buf = await downloadIproNvrMp4(
      { endpoint, username: user, password: pass, timeoutMs: 120_000 },
      channel, new Date(fromIso), new Date(toIso),
    )
    // i-PRO NVR は標準MP4。HEVC カメラの録画のみ H.264 へ変換（Chrome 再生のため）。
    return await transcodeHevcToH264IfNeeded(buf, id)
  }

  throw new Error(`window MP4 unsupported: vendor=${rec.vendor}`)
}
