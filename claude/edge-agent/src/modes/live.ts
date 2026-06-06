/**
 * Live Mode — single-camera JPEG snapshot polling.
 *
 * Fetches the camera's latest still image over HTTP (Frigate:
 * /api/<cam>/latest.jpg) at a high cadence and uploads each snapshot to
 * Supabase Storage at `edges/<edgeId>/cam/<cameraId>/snapshot.jpg`. The
 * browser polls that path to render a near-real-time view.
 *
 * Replaces the previous RTSP → ffmpeg → WHIP → LiveKit pipeline. That stack
 * gave smoother video but came with: LiveKit Cloud cost + ingress quota,
 * WHIP proxy + TCP-candidate stripping, the AirPlay-on-5000 collision, and
 * a 10+ s startup. For a "monitoring" use case where 1–2 fps is enough,
 * snapshot polling is dramatically simpler. RTSP and WHIP stay only in VOD
 * mode (modes/vod.ts) where smooth seek-from-instant playback matters.
 */
import { config } from '../config.js'
import { logger } from '../logger.js'
import { snapshotUrl } from '../rtsp/url.js'
import { uploadCameraSnapshot } from '../upload/storage.js'
import type { CameraDescriptor } from '../types.js'

type LiveHandle = { stop: () => Promise<void> }

export interface StartLiveInput {
  camera: CameraDescriptor
}

/** How often the edge fetches+uploads a single-camera snapshot. */
const LIVE_INTERVAL_MS = 1_000

export async function startLive(i: StartLiveInput): Promise<LiveHandle> {
  const url = snapshotUrl({
    vendor:         i.camera.recorder.vendor,
    host:           i.camera.recorder.host,
    port:           i.camera.recorder.rtsp_port,
    username:       i.camera.recorder.username,
    password:       i.camera.recorder.password,
    channel:        i.camera.channel,
    frigateCamera:  i.camera.frigate_camera ?? undefined,
    frigateApiPort: config.FRIGATE_API_PORT,
  })
  if (!url) {
    throw new Error(
      `live: vendor "${i.camera.recorder.vendor}" has no HTTP snapshot URL (ONVIF support is a TODO)`,
    )
  }

  logger.info({ camera_id: i.camera.id, intervalMs: LIVE_INTERVAL_MS }, 'live: starting snapshot loop')

  async function iterate(): Promise<void> {
    const r = await fetch(url!)
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const buf = Buffer.from(await r.arrayBuffer())
    await uploadCameraSnapshot(i.camera.id, buf)
  }

  let stopped = false
  void iterate().catch((e) => logger.warn({ err: String(e) }, 'live: iterate failed'))
  const timer = setInterval(() => {
    if (stopped) return
    void iterate().catch((e) => logger.warn({ err: String(e) }, 'live: iterate failed'))
  }, LIVE_INTERVAL_MS)

  return {
    async stop() {
      stopped = true
      clearInterval(timer)
      logger.info('live: stopped')
    },
  }
}
