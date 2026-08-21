/**
 * グリッド/ライブが使うスナップショット URL の組み立て。
 *
 * Frigate:
 *   http://<host>:<api_port>/api/<camera_name>/latest.jpg
 *
 * 他のベンダは null を返す（呼び出し側が暗いセルを描く）。
 * i-PRO NVR と ONVIF カメラ直はそれぞれ専用の取得経路を持っており、
 * ここは通らない（grid.ts / live.ts の分岐を参照）。
 *
 * ── 2026-08-19 に削除したもの ────────────────────────────────────────────
 * liveRtspUrl() と vodSourceUrl() をここから消した。**どちらも呼び出し元が
 * 無い**まま残っており、vodSourceUrl には Uniview の RTSP replay URL
 * (`rtsp://.../c<ch>/b<from>/e<to>/replay`) が書かれていた。
 * 実際の VOD は modes/vod.ts が i-PRO httpdl か Frigate clip.mp4 のどちらか
 * しか呼ばないので、この関数は一度も動いたことがない。
 *
 * それでも「実装がある」ように見えたため、Uniview は録画対応と誤解され、
 * クラウド側の VOD_VENDORS にも載っていた——**録画ボタンは出るが押すと
 * 失敗する**状態を生んだ。動かないコードを残すこと自体が誤解の原因になる。
 */

import type { Vendor } from '../types.js'

export interface RtspBuilderInput {
  vendor:    Vendor
  host:      string
  port:      number
  username:  string
  password:  string
  channel:   number   // 1-based
  substream?: boolean // prefer the lower-quality stream for grid view
  /** Frigate camera name (e.g. "camera_01"). Required when vendor='frigate' */
  frigateCamera?: string
  /**
   * Host port of Frigate's HTTP API. Optional override; defaults to 5000.
   * Callers (vod.ts) pass `config.FRIGATE_API_PORT` so deployments can remap
   * around the macOS AirPlay-on-5000 collision without touching code.
   */
  frigateApiPort?: number
}

const FRIGATE_API_PORT_DEFAULT = 5000

/**
 * URL for a still-image snapshot of the current camera frame.
 * Used by grid mode (compose 16 cells) and single live mode (poll one cam)
 * — both run on simple HTTP fetch loops instead of RTSP+ffmpeg+WHIP. RTSP
 * stays only for VOD playback where seeking from a specific instant matters.
 *
 * - frigate : http://<host>:<api_port>/api/<camera>/latest.jpg
 * 対応していないベンダは null を返し、グリッドは暗いセルを描く。
 * - ipro    : (TODO) ONVIF snapshot — same dark placeholder fallback.
 */
export function snapshotUrl(i: RtspBuilderInput): string | null {
  if (i.vendor === 'frigate') {
    const camName = i.frigateCamera ?? `camera_${String(i.channel).padStart(2, '0')}`
    const apiPort = i.frigateApiPort ?? FRIGATE_API_PORT_DEFAULT
    return `http://${i.host}:${apiPort}/api/${camName}/latest.jpg`
  }
  return null
}
