/**
 * Build playback source URLs for the supported vendors.
 *
 * i-PRO (network cameras, direct):
 *   live: rtsp://user:pass@<cam_ip>:554/MediaInput/h264/stream_1
 *   stream_1..stream_4 are quality profiles.
 *
 * Uniview NVR:
 *   live :  rtsp://user:pass@<nvr_ip>:554/unicast/c{CH}/s{0|1}/live
 *   vod  :  rtsp://user:pass@<nvr_ip>:554/c{CH}/b{startUnix}/e{endUnix}/replay
 *   s0 = main stream, s1 = sub stream.
 *
 * Frigate (OSS-VMS, go2rtc re-stream):
 *   live : rtsp://<host>:8554/<camera_name>
 *   vod  : http://<host>:5000/api/<camera_name>/start/<unixFrom>/end/<unixTo>/clip.mp4
 *   The MP4 export is a single faststart MP4; ffmpeg can stream it as input.
 *
 * i-PRO NVR VOD goes through ONVIF Profile-G; not built here.
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

function encodeCreds(user: string, pass: string): string {
  return `${encodeURIComponent(user)}:${encodeURIComponent(pass)}`
}

export function liveRtspUrl(i: RtspBuilderInput): string {
  // Frigate VMS re-stream (OSS-VMS): rtsp://<host>:8554/<camera_name>
  // For grid mode we ask for the substream (`<camera_name>_sub`) because the
  // main Frigate restream is known to drop frames after the initial keyframe
  // on some upstream RTSP cameras (the user's config has a comment to that
  // effect: "メインストリームは i/o timeout で不安定なため除外"). The sub
  // stream is reliable at the lower resolution and grid only needs ~0.5 fps.
  if (i.vendor === 'frigate') {
    const camName = i.frigateCamera ?? `camera_${String(i.channel).padStart(2, '0')}`
    const stream  = i.substream ? `${camName}_sub` : camName
    const auth = i.username
      ? `${encodeCreds(i.username, i.password)}@`
      : ''
    return `rtsp://${auth}${i.host}:${i.port}/${stream}`
  }

  const creds = encodeCreds(i.username, i.password)
  const auth  = `${creds}@${i.host}:${i.port}`
  if (i.vendor === 'ipro') {
    // i-PRO cameras: channel maps to the per-device endpoint, not the path.
    // For a 16ch site we expect 16 separate camera hosts, each with its own URL.
    const profile = i.substream ? 'stream_2' : 'stream_1'
    return `rtsp://${auth}/MediaInput/h264/${profile}`
  }
  // uniview
  const s = i.substream ? 's1' : 's0'
  return `rtsp://${auth}/unicast/c${i.channel}/${s}/live`
}

/**
 * Default host port for Frigate's HTTP API (clip.mp4 export). The container
 * exposes 5000 internally; the default assumes Docker maps 5000→5000 on the
 * host. Override via `frigateApiPort` on RtspBuilderInput when the host port
 * has to be remapped (e.g. macOS AirPlay shadows :5000).
 */
const FRIGATE_API_PORT_DEFAULT = 5000

/**
 * VOD source URL for ffmpeg `-i`. Supports uniview (RTSP replay) and frigate
 * (HTTP MP4 export). i-PRO requires ONVIF Profile-G and is not implemented.
 *
 * Both protocols are accepted by ffmpeg as input; the `-rtsp_transport` flag
 * on the caller side is benignly ignored for HTTP inputs.
 */
export function vodSourceUrl(
  i: RtspBuilderInput,
  fromIso: string,
  toIso:   string,
): string {
  const b = Math.floor(new Date(fromIso).getTime() / 1000)
  const e = Math.floor(new Date(toIso).getTime()   / 1000)

  if (i.vendor === 'uniview') {
    const creds = encodeCreds(i.username, i.password)
    const auth  = `${creds}@${i.host}:${i.port}`
    return `rtsp://${auth}/c${i.channel}/b${b}/e${e}/replay`
  }
  if (i.vendor === 'frigate') {
    // Frigate's clip.mp4 endpoint generates a single faststart MP4 for the
    // requested range. Camera name follows the same convention as live.
    const camName = i.frigateCamera ?? `camera_${String(i.channel).padStart(2, '0')}`
    const apiPort = i.frigateApiPort ?? FRIGATE_API_PORT_DEFAULT
    return `http://${i.host}:${apiPort}/api/${camName}/start/${b}/end/${e}/clip.mp4`
  }
  throw new Error(
    `VOD source not implemented for vendor "${i.vendor}" (i-PRO needs ONVIF Profile-G)`,
  )
}

/** Redact password from RTSP URL for logging. */
export function redactRtsp(url: string): string {
  return url.replace(/^rtsp:\/\/[^:]+:[^@]+@/, 'rtsp://****:****@')
}

/**
 * URL for a still-image snapshot of the current camera frame.
 * Used by grid mode (compose 16 cells) and single live mode (poll one cam)
 * — both run on simple HTTP fetch loops instead of RTSP+ffmpeg+WHIP. RTSP
 * stays only for VOD playback where seeking from a specific instant matters.
 *
 * - frigate : http://<host>:<api_port>/api/<camera>/latest.jpg
 * - uniview : (TODO) ONVIF Profile-S snapshot URI — returns null for now,
 *             which makes the grid composer paint a dark placeholder cell.
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
