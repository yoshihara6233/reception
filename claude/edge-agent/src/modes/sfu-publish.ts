/**
 * SFU publish mode（S1）— go2rtc の H.264 を LiveKit へ **WHIP** 配信する。
 *
 * 設計の要点:
 *   - transport は **WHIP**（LiveKit ネイティブ）。エッジには WHIP muxer 対応 ffmpeg（BtbN 等・
 *     7.1+）を配置する。WHIP 先は whip-proxy 経由（TCP ICE 候補除去・whip-proxy.ts）。
 *   - codec は **constrained baseline H.264 へ変換**。WHIP(WebRTC) ingress は素通しのため
 *     ブラウザ互換 profile が必須（High profile は再生不可）。
 *   - エンコーダは **VAAPI 優先・libx264 自動フォールバック**（VAAPI最適化）:
 *       GO2RTC_VAAPI_DEVICE が設定されていれば h264_vaapi（GPU・CPUほぼゼロ）で開始し、
 *       起動直後（VAAPI_PROBE_MS 以内）に異常終了したら libx264 で自動再起動する。
 *       一度失敗したらプロセス生存中は libx264 に固定（毎回のプローブ失敗を避ける）。
 *   - whipUrl は cloud が発行した LiveKit WHIP Ingress の publish URL。
 *
 * ライフサイクル: stop() で ffmpeg を SIGTERM。state-machine の単一 active ハンドルとして扱う。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { wrapWhip } from '../whip-proxy.js'
import { go2rtcRtspUrl, buildSfuFfmpegArgs, buildSfuFfmpegArgsVaapi } from './sfu-publish-core.js'
import type { CameraDescriptor } from '../types.js'

export interface StartSfuInput {
  camera:        CameraDescriptor
  room:          string
  whipUrl:       string   // cloud が発行した LiveKit WHIP Ingress の publish URL
  whipProxyBase: string   // whip-proxy の baseUrl（TCP ICE 候補除去）
}

export interface SfuHandle { stop: () => Promise<void> }

/** VAAPI 起動プローブ窓。この時間内の異常終了は「VAAPI 不成立」とみなし libx264 へ。 */
const VAAPI_PROBE_MS = 10_000

/** プロセス生存中の VAAPI 健全性。一度失敗したら以後の start は libx264 直行。 */
let vaapiHealthy = true

export async function startSfuPublish(input: StartSfuInput): Promise<SfuHandle> {
  const src    = go2rtcRtspUrl(input.camera.id, config.GO2RTC_RTSP_LISTEN)
  const target = wrapWhip(input.whipProxyBase, input.whipUrl)

  const device   = config.GO2RTC_VAAPI_DEVICE   // 空文字ならソフト変換（go2rtc と同じ規約）
  const useVaapi = vaapiHealthy && device.length > 0

  let stopped = false
  let current: ChildProcess

  const launch = (encoder: 'vaapi' | 'libx264'): ChildProcess => {
    const args = encoder === 'vaapi'
      ? buildSfuFfmpegArgsVaapi(src, target, device)
      : buildSfuFfmpegArgs(src, target)
    logger.info({ camera_id: input.camera.id, room: input.room, src, encoder }, 'sfu: publish start (go2rtc → baseline H.264 → WHIP)')

    // シェル不使用 spawn（配列引数）。src/target は単一 -i / -f 値でシェル展開されない。
    const proc: ChildProcess = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    proc.stderr?.on('data', (b: Buffer) => {
      const s = b.toString().trim()
      if (s) logger.warn({ camera_id: input.camera.id, encoder }, `sfu ffmpeg: ${s.slice(0, 300)}`)
    })
    proc.on('exit', (code, signal) => {
      logger.info({ camera_id: input.camera.id, encoder, code, signal }, 'sfu: publish ffmpeg exited')
    })
    return proc
  }

  current = launch(useVaapi ? 'vaapi' : 'libx264')

  if (useVaapi) {
    // VAAPI プローブ: 起動直後の異常終了（ドライバ非対応・profile 非対応等）を検知して
    // libx264 で自動再起動。stop() 済みは対象外。
    const startedAt = Date.now()
    current.on('exit', (code) => {
      if (stopped) return
      if (Date.now() - startedAt > VAAPI_PROBE_MS) return   // 長時間動いた後の死は VAAPI 起因と限らない
      if (code === 0) return
      vaapiHealthy = false
      logger.warn({ camera_id: input.camera.id, code }, 'sfu: VAAPI encode failed at startup — falling back to libx264 (sticky)')
      current = launch('libx264')
    })
  }

  return {
    async stop() {
      if (stopped) return
      stopped = true
      try { current.kill('SIGTERM') } catch { /* already gone */ }
    },
  }
}
