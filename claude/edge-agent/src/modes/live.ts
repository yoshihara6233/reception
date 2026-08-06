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
import { captureRtspKeyframe, injectRtspCreds } from '../rtsp/keyframe.js'
import { resolveOnvifRtspUrl } from '../adapters/onvif/onvif-rtsp.js'
import { getOnvifSnapshotUrl, fetchOnvifJpeg } from '../adapters/onvif/onvif-snapshot.js'
import { captureIproNvrJpeg, buildIproNvrEndpoint } from '../adapters/i-pro/nvr-live.js'
import { assertUsableJpeg } from '../util/jpeg.js'
import { uploadCameraSnapshot } from '../upload/storage.js'
import type { CameraDescriptor } from '../types.js'

type LiveHandle = { stop: () => Promise<void> }

export interface StartLiveInput {
  camera: CameraDescriptor
}

/** How often the edge fetches+uploads a single-camera snapshot. */
const LIVE_INTERVAL_MS = 1_000

/**
 * 1 フレーム JPEG を取得する関数を vendor 別に組む。
 * onvif-generic は grid と同じく HTTP JPEG スナップ優先・RTSP keyframe フォールバック。
 */
function buildCapture(cam: CameraDescriptor): () => Promise<Buffer> {
  const r = cam.recorder
  if (r.vendor === 'i-pro-nvr') {
    const endpoint = buildIproNvrEndpoint(r.host, r.onvif_port)
    return () => captureIproNvrJpeg(
      { endpoint, username: r.username, password: r.password, timeoutMs: 10_000 },
      cam.channel,
    )
  }
  if (r.vendor === 'onvif-generic') {
    const endpoint = `http://${r.host}:${r.onvif_port ?? 80}`
    const opts = { endpoint, username: r.username, password: r.password, timeoutMs: 8000 }
    let rtspUrl: string | null = null
    return async () => {
      const snapUrl = await getOnvifSnapshotUrl(opts, r.host, cam.channel)
      if (snapUrl) return fetchOnvifJpeg(snapUrl, r.username, r.password, 8000)
      if (!rtspUrl) {
        rtspUrl = injectRtspCreds(await resolveOnvifRtspUrl(opts, cam.channel), r.username, r.password)
      }
      return captureRtspKeyframe(rtspUrl, config.FFMPEG_BIN)
    }
  }

  // 既存: HTTP snapshot URL (Frigate 等)
  const url = snapshotUrl({
    vendor:         r.vendor,
    host:           r.host,
    port:           r.rtsp_port,
    username:       r.username,
    password:       r.password,
    channel:        cam.channel,
    frigateCamera:  cam.frigate_camera ?? undefined,
    frigateApiPort: config.FRIGATE_API_PORT,
  })
  if (!url) {
    throw new Error(`live: vendor "${r.vendor}" has no snapshot source`)
  }
  return async () => {
    const resp = await fetch(url)
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return Buffer.from(await resp.arrayBuffer())
  }
}

export async function startLive(i: StartLiveInput): Promise<LiveHandle> {
  const capture = buildCapture(i.camera)

  logger.info({ camera_id: i.camera.id, intervalMs: LIVE_INTERVAL_MS }, 'live: starting snapshot loop')

  async function iterate(): Promise<void> {
    const buf = await capture()
    // 機器のプレースホルダ画像を「更新できた」ことにしない（grid と同じ判定）。
    assertUsableJpeg(buf, `live(camera=${i.camera.id})`)
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
