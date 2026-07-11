/**
 * SFU publish mode（S1）— go2rtc の H.264 を LiveKit へ WHIP 配信する。
 *
 * 設計の要点:
 *   - **再エンコードしない**。go2rtc が既にカメラを H.265→H.264 変換して配信している
 *     （現行「🎬 高画質」HLS と同じ stream `cam_<id>`）。ここはその H.264 を RTSP で受け、
 *     `-c:v copy` で WHIP muxer に流すだけ。VAAPI 調整不要＝最も堅牢。
 *   - WHIP 先は cloud が発行した Ingress の publish URL。whip-proxy 経由で渡すことで
 *     ffmpeg WHIP muxer が TCP ICE 候補で失敗する既知問題（whip-proxy.ts）を回避する。
 *   - go2rtc は非単調DTSを出すことがあるため `-fflags +genpts` を付す（VOD再エンコードと同じ既知対策）。
 *
 * ライフサイクル: stop() で ffmpeg を SIGTERM。state-machine の単一 active ハンドルとして扱う。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { wrapWhip } from '../whip-proxy.js'
import { go2rtcRtspUrl, buildSfuFfmpegArgs } from './sfu-publish-core.js'
import type { CameraDescriptor } from '../types.js'

export interface StartSfuInput {
  camera:        CameraDescriptor
  room:          string
  whipUrl:       string   // cloud が発行した LiveKit Ingress の WHIP publish URL
  whipProxyBase: string   // whip-proxy の baseUrl（TCP ICE 候補除去）
}

export interface SfuHandle { stop: () => Promise<void> }

export async function startSfuPublish(input: StartSfuInput): Promise<SfuHandle> {
  const src    = go2rtcRtspUrl(input.camera.id, config.GO2RTC_RTSP_LISTEN)
  const target = wrapWhip(input.whipProxyBase, input.whipUrl)
  const args   = buildSfuFfmpegArgs(src, target)

  logger.info({ camera_id: input.camera.id, room: input.room, src }, 'sfu: publish start (go2rtc H.264 → WHIP)')

  // シェル不使用 spawn（配列引数）。src/target は単一 -i / -f 値でシェル展開されない。
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
