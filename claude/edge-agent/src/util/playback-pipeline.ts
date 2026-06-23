/**
 * F55.D: ffmpeg playback pipeline
 *
 * ベンダー横断ユーティリティ: RTSP playback URL を MP4 stream に変換する。
 *
 * 用途:
 *   - Hikvision の VOD search が RTSP playbackURI を返した場合
 *   - Dahua mediaFileFind が RTSP playback URL を返した場合
 *   - i-PRO ONVIF Profile-G の Replay (Phase 8+)
 *   - その他、RTSP しか出さないベンダーの録画再生
 *
 * 仕組み:
 *   - ffmpeg を spawn し RTSP を入力 → MP4 (faststart) を stdout に出力
 *   - 呼び出し側は Readable stream として受け取り、HTTP response / Supabase
 *     Storage に流す
 *
 * 既存の VOD パイプラインとの違い:
 *   - 既存 (rtsp/url.ts + modes/vod.ts) は LiveKit WHIP に流すための ffmpeg
 *   - 本パイプラインは MP4 ファイル変換に特化 (シーク可能な faststart MP4)
 *
 * 制約:
 *   - ffmpeg バイナリが PATH に必要
 *   - 60 分以上の VOD は処理時間が長い (ペーシング -re 含む)
 */
import { spawn, type ChildProcess } from 'child_process'
import { Readable } from 'stream'
import { logger } from '../logger.js'

export interface PlaybackPipelineOptions {
  /** RTSP playback URL (vendor 固有形式) */
  rtspUrl:        string
  /** RTSP トランスポート (デフォルト 'tcp') */
  transport?:     'tcp' | 'udp'
  /** 出力の最大時間制限 (秒)。安全装置 */
  maxDurationSec?: number
  /** ffmpeg のパス (デフォルト 'ffmpeg') */
  ffmpegPath?:    string
  /** デバッグログ */
  verbose?:       boolean
}

export interface PlaybackPipeline {
  /** 出力 MP4 を読み取る Readable stream */
  stream:    Readable
  /** ffmpeg プロセス (kill 用) */
  process:   ChildProcess
  /** 完了 / 中断 Promise (終了コードを返す) */
  finished:  Promise<number>
}

/**
 * RTSP playback URL から MP4 stream を作る。
 *
 * @example
 *   const pipeline = createPlaybackPipeline({
 *     rtspUrl: 'rtsp://user:pass@host/playback?starttime=...',
 *     maxDurationSec: 3600,
 *   })
 *   for await (const chunk of pipeline.stream) {
 *     // chunk を Supabase Storage または HTTP response に流す
 *   }
 *   const code = await pipeline.finished
 *   if (code !== 0) throw new Error(`ffmpeg exit ${code}`)
 */
export function createPlaybackPipeline(opts: PlaybackPipelineOptions): PlaybackPipeline {
  const ffmpegBin = opts.ffmpegPath ?? 'ffmpeg'
  const transport = opts.transport ?? 'tcp'

  // ffmpeg コマンドライン:
  //   -rtsp_transport tcp        : NAT 越えしやすい
  //   -i <rtsp>                  : 入力
  //   -c copy                    : 再エンコードなし (高速、画質劣化なし)
  //   -f mp4                     : MP4 コンテナ
  //   -movflags +faststart+frag_keyframe+empty_moov : ストリーミング配信可
  //   -t <maxDur>                : 安全装置 (省略可)
  //   pipe:1                     : stdout に出力
  const args = [
    '-hide_banner',
    '-loglevel', opts.verbose ? 'info' : 'warning',
    '-rtsp_transport', transport,
    '-i', opts.rtspUrl,
    '-c', 'copy',
    '-f', 'mp4',
    '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
  ]
  if (opts.maxDurationSec) {
    args.push('-t', String(opts.maxDurationSec))
  }
  args.push('pipe:1')

  // 安全: シェル不使用の spawn(配列引数)。ffmpegBin は config(env)由来の信頼値、
  // rtspUrl は単一の -i 引数値でシェル展開されない(フラグ脱出も不可)。
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
  const proc = spawn(ffmpegBin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // stderr は warn ログに流す (ffmpeg の進捗・警告)
  proc.stderr?.on('data', (chunk: Buffer) => {
    const msg = chunk.toString('utf-8').trim()
    if (msg.length > 0) {
      // ffmpeg の info ログは大量に出るので抜粋
      if (opts.verbose || /error|fail|denied|refused/i.test(msg)) {
        logger.warn({ pipeline: 'playback', ffmpeg: msg.slice(0, 200) }, 'ffmpeg stderr')
      }
    }
  })

  const finished = new Promise<number>((resolve, reject) => {
    proc.on('error', (err) => {
      reject(new Error(`ffmpeg spawn failed: ${err.message}`))
    })
    proc.on('exit', (code) => {
      resolve(code ?? 0)
    })
  })

  // stdout を Readable として返す (Node.js 標準 stream)
  const stream = proc.stdout
  // null チェック (型ガード)
  if (!stream) {
    proc.kill()
    throw new Error('ffmpeg stdout is null')
  }

  // 呼び出し側がストリームを早期 close した場合、ffmpeg も止める
  stream.on('close', () => {
    if (!proc.killed) proc.kill('SIGTERM')
  })

  return { stream, process: proc, finished }
}

/**
 * 簡便ラッパー: RTSP playback → MP4 を「全部」読み込んで Buffer で返す。
 * 30分超のシナリオではメモリ消費が大きいので避ける。
 * 通常は stream を直接使うべき。
 */
export async function fetchVodAsMp4Buffer(
  opts: PlaybackPipelineOptions,
): Promise<Buffer> {
  const pipeline = createPlaybackPipeline(opts)
  const chunks: Buffer[] = []
  for await (const chunk of pipeline.stream) {
    chunks.push(chunk as Buffer)
  }
  const code = await pipeline.finished
  if (code !== 0) {
    throw new Error(`ffmpeg playback pipeline exited with code ${code}`)
  }
  return Buffer.concat(chunks)
}
