/**
 * 録画からの単一フレーム抽出（BCP / 発報前後スナップ 共有）。
 *
 * 「過去のある時刻」の 1 枚を JPEG で取り出すための下請け。ベンダ別に:
 *   - Frigate      … 録画エンドポイント clip.mp4（対象±1秒）→ ffmpeg 先頭フレーム
 *   - i-PRO NVR    … httpdl.cgi（VOD と同経路）で対象±数秒の MP4 → ffmpeg 先頭フレーム
 * を提供する。ffmpeg 抽出（extractFirstFrame）は両者で共通。
 *
 * これらは元々 modes/bcp.ts に閉じていたが、発報前後スナップ（alarm/timeline.ts）でも
 * 同じ抽出が要るため共有モジュールへ切り出した。挙動は BCP 当時と同一。
 */
import { spawn } from 'child_process'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { downloadIproNvrMp4 } from '../adapters/i-pro/nvr-vod.js'

/**
 * MP4 バッファの先頭（または seekSec 秒地点）のフレームを JPEG 化する。失敗時 null。
 * Frigate / i-PRO NVR の過去フレーム経路で共有。
 *
 * MP4 を一時ファイルに書き `-i <file>` でシーク可能に読む（stdin パイプは非シーク＝
 * moov が末尾の NU-100 録画を demux できない）。
 * seekSec は出力シーク（`-i` の後の `-ss`）＝先頭からデコードしてフレーム精度で
 * 拾う。クリップは高々 1〜2 分なのでコストは無視できる。
 */
export async function extractFirstFrame(mp4: Buffer, seekSec = 0): Promise<Buffer | null> {
  const dir    = join(tmpdir(), 'intereco-edge-frame')
  const inPath = join(dir, `${crypto.randomUUID()}.mp4`)
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(inPath, mp4)

    return await new Promise<Buffer | null>((resolve) => {
      const ff = spawn(config.FFMPEG_BIN, [
        '-hide_banner',
        '-loglevel', 'error',
        '-i', inPath,
        ...(seekSec > 0 ? ['-ss', String(seekSec)] : []),
        '-frames:v', '1',
        '-q:v', '3',          // JPEG quality (2-31, lower is better)
        '-f', 'image2',
        '-c:v', 'mjpeg',
        'pipe:1',
      ])

      const chunks: Buffer[] = []
      let stderrBuf = ''
      let resolved = false

      ff.stdout.on('data', (c: Buffer) => chunks.push(c))
      ff.stderr.on('data', (c: Buffer) => { stderrBuf += c.toString('utf8') })

      ff.on('error', () => {
        if (resolved) return
        resolved = true
        resolve(null)
      })
      ff.on('close', (code) => {
        if (resolved) return
        resolved = true
        if (code !== 0) {
          logger.debug({ code, stderr: stderrBuf.slice(0, 200) }, 'frame: ffmpeg extract failed')
          return resolve(null)
        }
        const out = Buffer.concat(chunks)
        // Validate: minimum JPEG SOI marker (0xFFD8)
        if (out.length < 2 || out[0] !== 0xff || out[1] !== 0xd8) {
          return resolve(null)
        }
        resolve(out)
      })
    })
  } catch (e) {
    logger.debug({ err: (e as Error).message }, 'frame: extractFirstFrame temp write failed')
    return null
  } finally {
    await unlink(inPath).catch(() => {})
  }
}

/**
 * Frigate の録画から、指定の過去時刻のフレームを 1 枚取り出す。失敗時 null。
 * 1 秒 clip.mp4 を取得 → extractFirstFrame。Frigate 以外は非対応。
 */
export async function fetchFrigateHistoricalFrame(
  frigateHost:    string,
  frigateApiPort: number,
  frigateCamera:  string,
  targetMs:       number,
): Promise<Buffer | null> {
  const tsSec = Math.floor(targetMs / 1000)
  const clipUrl =
    `http://${frigateHost}:${frigateApiPort}` +
    `/api/${encodeURIComponent(frigateCamera)}/start/${tsSec}/end/${tsSec + 1}/clip.mp4`

  let mp4: Buffer
  try {
    const r = await fetch(clipUrl)
    if (!r.ok) return null
    const ab = await r.arrayBuffer()
    if (ab.byteLength < 1024) return null  // Frigate returns ~0 bytes if no recording
    mp4 = Buffer.from(ab)
  } catch {
    return null
  }

  return extractFirstFrame(mp4)
}

/**
 * i-PRO NVR（NU-100 等）の録画から、指定時刻のフレームを 1 枚取り出す。失敗時 null。
 * VOD と同じ httpdl.cgi 経路で対象時刻±数秒の MP4 を取得し ffmpeg で先頭フレーム化する。
 */
export async function fetchIproNvrHistoricalFrame(
  nvr:      { endpoint: string; username: string; password: string },
  channel:  number,
  targetMs: number,
): Promise<Buffer | null> {
  try {
    // httpdl.cgi の開始指定は分単位（切り捨て）。従来は t-1秒 から窓を取っていたため、
    // t が分ちょうど（BCP スナップ）のとき開始が 1 分前へ丸まり、先頭フレーム
    // （＝対象の約60〜65秒前）が採用されていた。対象を含む分から窓を取り、クリップ内で
    // 対象時刻までシークして「対象時刻のフレーム」を拾う（残差は直前キーフレーム分の
    // 1〜2秒以内）。窓は +10 秒で GOP 欠けも防げる。
    const MINUTE_MS = 60_000
    const windowStartMs = Math.floor(targetMs / MINUTE_MS) * MINUTE_MS
    const from = new Date(windowStartMs)
    const to   = new Date(targetMs + 10_000)
    const mp4  = await downloadIproNvrMp4(
      { endpoint: nvr.endpoint, username: nvr.username, password: nvr.password, timeoutMs: 30_000 },
      channel,
      from,
      to,
    )
    if (!mp4 || mp4.length < 1024) return null
    const seekSec = (targetMs - windowStartMs) / 1000
    // シーク位置が録画の切れ目等で取れない場合は先頭フレームにフォールバック。
    return (await extractFirstFrame(mp4, seekSec)) ?? (await extractFirstFrame(mp4))
  } catch (e) {
    logger.debug({ err: (e as Error).message, channel }, 'frame: i-PRO NVR historical frame failed')
    return null
  }
}
