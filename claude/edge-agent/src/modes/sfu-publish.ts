/**
 * SFU publish mode（S1）— go2rtc の映像を H.264 に変換して LiveKit へ **RTMP** 配信する。
 *
 * 設計の要点:
 *   - transport は **RTMP**（LiveKit RTMP Ingress）。ffmpeg の WHIP muxer は 7.1+ 限定で
 *     現地エッジの ffmpeg には無い（"output format 'whip' is not known"）。RTMP/FLV は全ビルドに存在。
 *   - codec は **H.264 へ変換**（libx264 ultrafast）。i-PRO 等 H.265 カメラは go2rtc RTSP でも
 *     hevc のまま来るため、ここで確実に H.264 化する（WebRTC/LiveKit は H.264 必須）。
 *   - publish URL は cloud が発行した RTMP Ingress の `rtmp://…/streamKey`。
 *
 * ライフサイクル: stop() で ffmpeg を SIGTERM。state-machine の単一 active ハンドルとして扱う。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { go2rtcRtspUrl, buildSfuFfmpegArgs } from './sfu-publish-core.js'
import type { CameraDescriptor } from '../types.js'

export interface StartSfuInput {
  camera:     CameraDescriptor
  room:       string
  publishUrl: string   // cloud が発行した LiveKit RTMP Ingress の publish URL（rtmp://…/key）
}

export interface SfuHandle { stop: () => Promise<void> }

export async function startSfuPublish(input: StartSfuInput): Promise<SfuHandle> {
  const src  = go2rtcRtspUrl(input.camera.id, config.GO2RTC_RTSP_LISTEN)
  const args = buildSfuFfmpegArgs(src, input.publishUrl)

  logger.info({ camera_id: input.camera.id, room: input.room, src }, 'sfu: publish start (go2rtc → H.264 → RTMP)')

  // シェル不使用 spawn（配列引数）。src/publishUrl は単一 -i / -f 値でシェル展開されない。
  const proc: ChildProcess = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
  proc.stderr?.on('data', (b: Buffer) => {
    const s = b.toString().trim()
    if (s) logger.warn({ camera_id: input.camera.id }, `sfu ffmpeg: ${s.slice(0, 300)}`)
  })
  proc.on('exit', (code, signal) => {
    logger.info({ camera_id: input.camera.id, code, signal }, 'sfu: publish ffmpeg exited')
  })

  let stopped = false
  return {
    async stop() {
      if (stopped) return
      stopped = true
      try { proc.kill('SIGTERM') } catch { /* already gone */ }
    },
  }
}
