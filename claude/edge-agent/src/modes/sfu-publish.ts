/**
 * SFU publish mode（S1）— go2rtc の H.264 を無変換で LiveKit へ **WHIP** 配信する。
 *
 * 設計の要点:
 *   - transport は **WHIP**（LiveKit ネイティブ）。エッジには WHIP muxer 対応 ffmpeg（BtbN 等・
 *     7.1+）を配置する。WHIP 先は whip-proxy 経由（TCP ICE 候補除去・whip-proxy.ts）。
 *   - codec は **baseline H.264 へ変換**。WHIP(WebRTC) ingress は素通しのためブラウザ互換
 *     profile が必須（High profile は再生不可）。libx264 ultrafast で低負荷。
 *   - whipUrl は cloud が発行した LiveKit WHIP Ingress の publish URL。
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
  whipUrl:       string   // cloud が発行した LiveKit WHIP Ingress の publish URL
  whipProxyBase: string   // whip-proxy の baseUrl（TCP ICE 候補除去）
}

export interface SfuHandle { stop: () => Promise<void> }

export async function startSfuPublish(input: StartSfuInput): Promise<SfuHandle> {
  const src    = go2rtcRtspUrl(input.camera.id, config.GO2RTC_RTSP_LISTEN)
  const target = wrapWhip(input.whipProxyBase, input.whipUrl)
  const args   = buildSfuFfmpegArgs(src, target)

  logger.info({ camera_id: input.camera.id, room: input.room, src }, 'sfu: publish start (go2rtc → baseline H.264 → WHIP)')

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
