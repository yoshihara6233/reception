/**
 * BCP Snapshot Mode (F40) — capture 8 JPEG snapshots per camera at fixed
 * offsets from the alert moment.
 *
 * Old behavior (pre-F40): retrieve a 30-min RTSP VOD clip via ffmpeg.
 *   Replaced because the resulting MP4 was huge (~hundreds of MB / camera)
 *   and most consumers (insurance / regulator) only want a visual timeline,
 *   not full-motion footage.
 *
 * New behavior: 8 stills at T-5, T+0, T+5, T+10, T+15, T+20, T+25, T+30
 * minutes. Each ~50 KB JPEG → ~400 KB total / camera. Easy to PDF, easy to
 * download (no transcoding), and well within Frigate's snapshot endpoint
 * capacity. T-5 falls back to "the latest snapshot at the moment the alert
 * fired" since we cannot time-travel.
 *
 * Storage layout (F61: JST timestamp suffix added):
 *   bcp-clips/<eventId>/<cameraId>/<offsetKey>_<timestamp>.jpg
 *   where:
 *     offsetKey  = "m5" for -5, "p0" for 0, "p5" for +5, etc. (sortable)
 *     timestamp  = YYYYMMDD_HHMMSS in JST (e.g. 20260605_211005 = 2026/06/05 21:10:05 JST)
 *   example: bcp-clips/abc.../xyz.../p0_20260605_211005.jpg
 *
 * DB:
 *   bcp_clips row per snapshot. offset_min column added by migration
 *   20260531_001. clip_url and thumbnail_url both point at the same JPEG.
 */
import { spawn } from 'child_process'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { snapshotUrl } from '../rtsp/url.js'
import { Semaphore } from '../util/semaphore.js'
import { fetchBcpSnapshot } from '../bcp-fetchers/index.js'
import type { CameraDescriptor } from '../types.js'

const BCP_BUCKET    = 'bcp-clips'
const CONCURRENCY   = 4
const SNAPSHOT_OFFSETS_MIN = [-5, 0, 5, 10, 15, 20, 25, 30] as const

// ── Public types ─────────────────────────────────────────────────────────────

export interface BcpClip {
  clipId:   string
  cameraId: string
}

export interface BcpCaptureCommand {
  eventId:  string
  clips:    BcpClip[]
  /** ISO 8601 — alert_issued_at (used as T+0 reference) */
  clipFrom: string
  /** ISO 8601 — kept for backward compat; ignored in snapshot mode */
  clipTo:   string
}

export interface BcpResult {
  successCount: number
  totalCount:   number
}

// ── Supabase client (lazily created) ──────────────────────────────────────────

let _supa: SupabaseClient | null = null
export function _setSupaClient(client: SupabaseClient): void { _supa = client }
function getSupa(): SupabaseClient {
  if (!_supa) {
    _supa = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return _supa
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** offset_min → sortable storage key suffix ("m5", "p0", "p5", "p30"). */
function offsetKey(min: number): string {
  if (min < 0) return `m${Math.abs(min)}`
  return `p${min}`
}

/**
 * Build a sortable JST (Asia/Tokyo, UTC+9) timestamp suffix for storage filenames.
 * Format: YYYYMMDD_HHMMSS (e.g. 20260605_211005 = 2026年06月05日 21時10分05秒 JST).
 * JST is used to match the timestamp overlay on the camera image so operators
 * can correlate filenames with what they see in the picture.
 */
function timestampSuffix(d: Date): string {
  // JST = UTC + 9 hours
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${jst.getUTCFullYear()}${pad(jst.getUTCMonth() + 1)}${pad(jst.getUTCDate())}` +
    `_${pad(jst.getUTCHours())}${pad(jst.getUTCMinutes())}${pad(jst.getUTCSeconds())}`
  )
}

/** Wait until target instant (no-op if already past). */
function waitUntil(targetMs: number): Promise<void> {
  const delay = Math.max(0, targetMs - Date.now())
  if (delay === 0) return Promise.resolve()
  return new Promise((res) => setTimeout(res, delay))
}

/**
 * F70: Try to fetch a single frame from Frigate's recorded video at a
 * specific past timestamp, so T-5/T+0/etc. show the actual moment instead
 * of "whatever Frigate has now" (which previously gave 4 identical frames).
 *
 * Strategy:
 *   1. Pull a 1-second mp4 clip from Frigate's recording endpoint covering
 *      the target instant.
 *   2. Pipe the clip into `ffmpeg -frames:v 1 -f mjpeg pipe:1` to extract
 *      the first frame as a JPEG buffer.
 *
 * Returns null on any failure so callers can fall back to `latest.jpg`.
 *
 * Only meaningful for Frigate. Other vendors don't expose this endpoint.
 */
async function fetchFrigateHistoricalFrame(
  frigateHost:    string,
  frigateApiPort: number,
  frigateCamera:  string,
  targetMs:       number,
): Promise<Buffer | null> {
  const tsSec = Math.floor(targetMs / 1000)
  const clipUrl =
    `http://${frigateHost}:${frigateApiPort}` +
    `/api/${encodeURIComponent(frigateCamera)}/start/${tsSec}/end/${tsSec + 1}/clip.mp4`

  let mp4: Buffer
  try {
    const r = await fetch(clipUrl)
    if (!r.ok) return null
    const ab = await r.arrayBuffer()
    if (ab.byteLength < 1024) return null  // Frigate returns ~0 bytes if no recording
    mp4 = Buffer.from(ab)
  } catch {
    return null
  }

  return new Promise<Buffer | null>((resolve) => {
    const ff = spawn(config.FFMPEG_BIN, [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', 'pipe:0',
      '-frames:v', '1',
      '-q:v', '3',          // JPEG quality (2-31, lower is better)
      '-f', 'image2',
      '-c:v', 'mjpeg',
      'pipe:1',
    ])

    const chunks: Buffer[] = []
    let stderrBuf = ''
    let resolved = false

    ff.stdout.on('data', (c: Buffer) => chunks.push(c))
    ff.stderr.on('data', (c: Buffer) => { stderrBuf += c.toString('utf8') })

    ff.on('error', () => {
      if (resolved) return
      resolved = true
      resolve(null)
    })
    ff.on('close', (code) => {
      if (resolved) return
      resolved = true
      if (code !== 0) {
        logger.debug({ code, stderr: stderrBuf.slice(0, 200) }, 'bcp: ffmpeg frame extract failed')
        return resolve(null)
      }
      const out = Buffer.concat(chunks)
      // Validate: minimum JPEG SOI marker (0xFFD8)
      if (out.length < 2 || out[0] !== 0xff || out[1] !== 0xd8) {
        return resolve(null)
      }
      resolve(out)
    })

    ff.stdin.on('error', () => { /* ignore EPIPE if ffmpeg already gave up */ })
    ff.stdin.write(mp4)
    ff.stdin.end()
  })
}

async function captureOneSnapshot(
  eventId:    string,
  cameraId:   string,
  camera:     CameraDescriptor,
  offsetMin:  number,
  capturedAt: Date,
  targetMs:   number,
): Promise<{ ok: true; storage_path: string; public_url: string; source: string } | { ok: false; error: string }> {
  let buf: Buffer | null = null
  let source = 'latest'
  const isPast = targetMs < Date.now() - 5_000

  // F70: For Frigate, if the target moment is in the past, try to pull the
  // historical frame from Frigate's recordings first. This makes T-5/T+0/etc.
  // show what the camera was actually seeing at each timestamp instead of
  // 4-8 copies of "whatever Frigate had at processing time".
  if (
    camera.recorder.vendor === 'frigate' &&
    camera.frigate_camera &&
    isPast
  ) {
    const historical = await fetchFrigateHistoricalFrame(
      camera.recorder.host,
      config.FRIGATE_API_PORT,
      camera.frigate_camera,
      targetMs,
    )
    if (historical) {
      buf = historical
      source = 'frigate-recording'
    }
  }

  // F106: i-PRO / Uniview dispatch via BCP fetchers. i-PRO v3+ supports
  // ?time=<ts> for the actual past instant; v1/v2 silently degrade to latest.
  // Uniview LAPI always returns latest (no time-indexed endpoint yet).
  if (
    !buf &&
    (camera.recorder.vendor === 'ipro' || camera.recorder.vendor === 'uniview')
  ) {
    try {
      const r = await fetchBcpSnapshot(camera, isPast ? new Date(targetMs) : null)
      if (r) {
        buf    = r.body
        source = r.source === 'historical' ? `${camera.recorder.vendor}-historical` : `${camera.recorder.vendor}-latest`
      }
    } catch (e) {
      logger.debug(
        { err: (e as Error).message, vendor: camera.recorder.vendor, channel: camera.channel },
        'bcp: vendor snapshot fetch failed, falling back to legacy URL path',
      )
    }
  }

  // Fallback / non-supported vendor / future offsets: use the legacy
  // snapshotUrl() builder. For non-Frigate vendors this currently returns
  // null (snapshotUrl is Frigate-only after F106 — i-PRO/Uniview moved to
  // the bcp-fetchers dispatcher above).
  if (!buf) {
    const src = snapshotUrl({
      vendor:         camera.recorder.vendor,
      host:           camera.recorder.host,
      port:           camera.recorder.rtsp_port,
      username:       camera.recorder.username,
      password:       camera.recorder.password,
      channel:        camera.channel,
      frigateCamera:  camera.frigate_camera ?? undefined,
      frigateApiPort: config.FRIGATE_API_PORT,
    })
    if (!src) return { ok: false, error: 'no snapshot URL for vendor' }

    try {
      const r = await fetch(src)
      if (!r.ok) return { ok: false, error: `fetch ${r.status}` }
      buf = Buffer.from(await r.arrayBuffer())
    } catch (e) {
      return { ok: false, error: String((e as Error).message ?? e) }
    }
  }

  // F61: Include capture timestamp (JST) in the filename so the actual moment
  // the snapshot was taken is self-documenting.
  const key = `${eventId}/${cameraId}/${offsetKey(offsetMin)}_${timestampSuffix(capturedAt)}.jpg`
  const { error } = await getSupa().storage
    .from(BCP_BUCKET)
    .upload(key, buf, { contentType: 'image/jpeg', upsert: true })
  if (error) return { ok: false, error: error.message }

  const { data: u } = getSupa().storage.from(BCP_BUCKET).getPublicUrl(key)
  logger.info(
    { eventId, cameraId, offsetMin, bytes: buf.length, key, source },
    'bcp: snapshot ok',
  )
  // Best-effort: caller does the bcp_clips upsert. We just return URLs.
  return { ok: true, storage_path: key, public_url: u.publicUrl, source }
}

/**
 * For a single (event, camera) tuple: take 8 snapshots at the configured
 * offsets. Each one is upserted into bcp_clips as its own row, keyed by
 * (event_id, camera_id, offset_min).
 *
 * Returns the count of snapshots that succeeded (0..8).
 */
async function captureCameraTimeline(
  eventId:        string,
  camera:         CameraDescriptor,
  alertIssuedMs:  number,
  sem:            Semaphore,
): Promise<number> {
  let successCount = 0

  for (const offsetMin of SNAPSHOT_OFFSETS_MIN) {
    const targetMs = alertIssuedMs + offsetMin * 60_000
    if (offsetMin >= 0) {
      // Future offsets: wait until that moment to capture a fresh frame.
      await waitUntil(targetMs)
    }
    // F70: For past offsets (T-5 etc.), captureOneSnapshot first tries to
    // pull the historical frame from Frigate's recordings via clip.mp4 +
    // ffmpeg first-frame extraction. If that fails (no recording, ffmpeg
    // missing, etc.), it falls back to `latest.jpg` — which is what we did
    // for the whole PoC before F70.

    const capturedAt = new Date()  // actual capture wall-clock
    const result = await sem.run(() => captureOneSnapshot(
      eventId, camera.id, camera, offsetMin, capturedAt, targetMs,
    ))

    const row = {
      event_id:      eventId,
      camera_id:     camera.id,
      offset_min:    offsetMin,
      clip_from:     new Date(targetMs).toISOString(),
      clip_to:       new Date(targetMs).toISOString(),
      duration_sec: 0,
      upload_status: result.ok ? 'completed' : 'failed',
      // F76: storage_path is the source of truth. clip_url / thumbnail_url
      // are kept for legacy readers (old /bcp/[id] pages) until we remove
      // them in a follow-up migration. New consumers should read storage_path
      // and route through the API proxy at /api/bcp/clip/[id].
      storage_path:  result.ok ? result.storage_path : null,
      clip_url:      result.ok ? result.public_url   : null,
      thumbnail_url: result.ok ? result.public_url   : null,
    }
    const { error } = await getSupa()
      .from('bcp_clips')
      .insert(row)
    if (error) {
      logger.warn({ err: error.message, eventId, cameraId: camera.id, offsetMin }, 'bcp: insert failed')
    } else if (result.ok) {
      successCount++
    }
  }
  return successCount
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function runBcpCapture(
  cmd:     BcpCaptureCommand,
  cameras: CameraDescriptor[],
): Promise<BcpResult> {
  const { eventId, clips, clipFrom } = cmd
  const alertIssuedMs = new Date(clipFrom).getTime()
  // Deduplicate cameras (the legacy command structure has 1 clip per camera
  // already, but defensive in case it ever sends duplicates).
  const cameraIds = [...new Set(clips.map((c) => c.cameraId))]
  const totalCount = cameraIds.length * SNAPSHOT_OFFSETS_MIN.length

  if (cameraIds.length === 0) {
    logger.info({ eventId }, 'bcp: no cameras to snapshot')
    return { successCount: 0, totalCount: 0 }
  }

  logger.info(
    { eventId, cameras: cameraIds.length, snapshotsTotal: totalCount, alertIssued: clipFrom },
    'bcp: starting snapshot timeline capture',
  )

  const sem = new Semaphore(CONCURRENCY)
  const results = await Promise.allSettled(
    cameraIds.map((cameraId) => {
      const camera = cameras.find((c) => c.id === cameraId)
      if (!camera) {
        logger.warn({ eventId, cameraId }, 'bcp: unknown camera, skipping')
        return Promise.resolve(0)
      }
      return captureCameraTimeline(eventId, camera, alertIssuedMs, sem)
    }),
  )

  const successCount = results.reduce(
    (n, r) => n + (r.status === 'fulfilled' ? r.value : 0),
    0,
  )

  logger.info({ eventId, successCount, totalCount }, 'bcp: snapshot capture complete')

  // Mark event failed only if literally no snapshot succeeded.
  if (successCount === 0) {
    const { error } = await getSupa()
      .from('bcp_events')
      .update({ status: 'failed' })
      .eq('id', eventId)
    if (error) logger.warn({ err: error.message, eventId }, 'bcp: event update failed')
  }

  return { successCount, totalCount }
}
