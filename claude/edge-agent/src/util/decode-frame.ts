/**
 * Annex-B のエレメンタリストリーム（H.264/H.265）から JPEG を1枚作る。
 *
 * NVR 経由ライブ（adapters/i-pro/nvr-rtp.ts で復元したキーフレーム）を
 * ブラウザに出せる形にするための最終段。ffmpeg は stdin から食わせるので
 * 一時ファイルを作らない。
 */
import { spawn } from 'node:child_process'

/** ffmpeg の入力フォーマット名（`-f` に渡す値）。 */
const INPUT_FORMAT = { h264: 'h264', h265: 'hevc' } as const

/**
 * ES の先頭フレームを JPEG にする。
 *
 * 渡す ES は「パラメータセット + 完結したキーフレーム1枚」を想定している
 * （途中から切り出したストリームを渡すと `SPS 0 does not exist` 等が出て失敗する）。
 *
 * @throws ffmpeg が非ゼロ終了 / タイムアウト / 出力が空のとき。
 */
export function decodeAnnexBToJpeg(
  es:        Buffer,
  codec:     keyof typeof INPUT_FORMAT,
  ffmpegBin: string,
  timeoutMs  = 10_000,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(ffmpegBin, [
      '-hide_banner', '-loglevel', 'error',
      '-f', INPUT_FORMAT[codec],
      '-i', 'pipe:0',
      '-frames:v', '1',
      '-an',
      '-f', 'image2',
      '-vcodec', 'mjpeg',
      '-q:v', '3',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })

    const chunks: Buffer[] = []
    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('ffmpeg decode timeout'))
    }, timeoutMs)

    proc.stdout.on('data', (b: Buffer) => chunks.push(b))
    proc.stderr.on('data', (b: Buffer) => { stderr += b.toString() })
    proc.on('error', (e) => { clearTimeout(timer); reject(e) })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      const buf = Buffer.concat(chunks)
      if (code === 0 && buf.length > 0) resolve(buf)
      else reject(new Error(`ffmpeg decode exit ${code}: ${stderr.slice(0, 300)}`))
    })

    // 1フレーム取れた時点で ffmpeg は先に終了する＝書き込み側が EPIPE になる。
    // 正常系なので握り潰す（exit ハンドラが成否を決める）。
    proc.stdin.on('error', () => undefined)
    proc.stdin.end(es)
  })
}
