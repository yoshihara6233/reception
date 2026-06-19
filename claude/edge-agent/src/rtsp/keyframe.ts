/**
 * RTSP から 1 フレームを JPEG で取り出す (グリッド/スナップ用)。
 *
 * 2026-06-19 実機スパイクで、i-PRO カメラのライブは ONVIF GetStreamUri →
 * RTSP DESCRIBE 200 で成立 (コーデックは機種により H.264 / H.265 混在)。
 * グリッドは JPEG 合成なので、ffmpeg で 1 フレーム取り出せば H.265 でも
 * そのまま JPEG 化でき、ブラウザの H.265 非対応も回避できる。
 */
import { spawn } from 'node:child_process'

/**
 * rtsp URL に資格情報を差し込む。既存の userinfo があれば置換する。
 * ONVIF GetStreamUri は creds 無しの URL を返すため、ffmpeg 用に付与する。
 */
export function injectRtspCreds(url: string, user: string, pass: string): string {
  if (!user) return url
  const m = url.match(/^(rtsps?:\/\/)(.*)$/i)
  if (!m) return url
  const scheme = m[1]
  let rest = m[2]
  // 既存 userinfo を除去 (最初の '/' より前に '@' がある場合のみ)
  const at = rest.indexOf('@')
  const slash = rest.indexOf('/')
  if (at !== -1 && (slash === -1 || at < slash)) rest = rest.slice(at + 1)
  const creds = `${encodeURIComponent(user)}:${encodeURIComponent(pass)}`
  return `${scheme}${creds}@${rest}`
}

/**
 * RTSP ストリームから先頭 1 フレームを取り出し JPEG バッファで返す。
 * H.264 / H.265 いずれもデコードして mjpeg にエンコードする。
 * @throws ffmpeg が非ゼロ終了 / タイムアウト / 出力空のとき。
 */
export function captureRtspKeyframe(
  url: string,
  ffmpegBin: string,
  timeoutMs = 10_000,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(ffmpegBin, [
      '-hide_banner', '-loglevel', 'error',
      '-rtsp_transport', 'tcp',
      '-i', url,
      '-frames:v', '1',
      '-an',
      '-f', 'image2',
      '-vcodec', 'mjpeg',
      '-q:v', '3',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'pipe'] })

    const chunks: Buffer[] = []
    let stderr = ''
    const timer = setTimeout(() => {
      proc.kill('SIGKILL')
      reject(new Error('ffmpeg keyframe timeout'))
    }, timeoutMs)

    proc.stdout?.on('data', (b: Buffer) => chunks.push(b))
    proc.stderr?.on('data', (b: Buffer) => { stderr += b.toString() })
    proc.on('error', (e) => { clearTimeout(timer); reject(e) })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      const buf = Buffer.concat(chunks)
      if (code === 0 && buf.length > 0) resolve(buf)
      else reject(new Error(`ffmpeg keyframe exit ${code}: ${stderr.slice(0, 300)}`))
    })
  })
}
