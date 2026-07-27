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
import { type SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from '../supabase.js'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { snapshotUrl } from '../rtsp/url.js'
import { Semaphore } from '../util/semaphore.js'
import { fetchBcpSnapshot } from '../bcp-fetchers/index.js'
import {
  fetchFrigateHistoricalFrame,
  fetchIproNvrHistoricalFrame,
} from '../security/recording-frame.js'
import { captureIproNvrJpeg } from '../adapters/i-pro/nvr-live.js'
import { captureAtMs, normalizeOffsets } from './bcp-timing.js'
import {
  hasBcpSnapshotPath,
  bcpUnavailableReason,
  type BcpCapabilityInput,
} from './bcp-capability.js'
import type { CameraDescriptor } from '../types.js'

const BCP_BUCKET    = 'bcp-clips'
const CONCURRENCY   = 4

/** NVR の host 設定を http(s) エンドポイントへ正規化する（grid.ts / vod.ts と同じ規則）。 */
function nvrEndpoint(host: string): string {
  return host.startsWith('http') ? host : `https://${host}`
}

/** カメラ記述子から取得可否の判定入力を作る。判定本体は bcp-capability.ts。 */
function capabilityOf(camera: CameraDescriptor): BcpCapabilityInput {
  return { vendor: camera.recorder.vendor, vodHost: camera.recorder.vod_host }
}

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
  /** Snapshot offsets (minutes from the alert) to capture. Empty/undefined → DEFAULT_SNAPSHOT_OFFSETS. */
  offsets?: number[]
}

export interface BcpResult {
  successCount: number
  totalCount:   number
}

// ── Supabase client (lazily created) ──────────────────────────────────────────

let _supa: SupabaseClient | null = null
export function _setSupaClient(client: SupabaseClient): void { _supa = client }
function getSupa(): SupabaseClient {
  return _supa ?? getSupabase()   // テスト override 優先・通常は中央クライアント(鍵同期)
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

  // 取得経路が無い構成は、8 枚すべてを試して毎回同じ理由で落ちる前に打ち切る。
  // ベンダ名を含めることで、発災後のログから設定不備だと即断できる。
  const cap = capabilityOf(camera)
  if (!hasBcpSnapshotPath(cap)) {
    return { ok: false, error: bcpUnavailableReason(cap) }
  }

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

  // NU-100 等 i-PRO NVR: onvif-generic（カメラ直ライブ）でも recorder に vod_host(NVR) が
  // あれば、VOD と同経路で NU-100 の録画から過去フレームを取得する。これにより録画は
  // NVR・ライブはカメラ直、という PoC 構成でも BCP の8枚を作れる。
  if (
    !buf &&
    camera.recorder.vendor === 'onvif-generic' &&
    camera.recorder.vod_host &&
    isPast
  ) {
    const nvrFrame = await fetchIproNvrHistoricalFrame(
      {
        endpoint: nvrEndpoint(camera.recorder.vod_host),
        username: camera.recorder.vod_username ?? camera.recorder.username,
        password: camera.recorder.vod_password ?? camera.recorder.password,
      },
      camera.recorder.vod_channel ?? camera.channel,
      targetMs,
    )
    if (nvrFrame) { buf = nvrFrame; source = 'ipro-nvr-recording' }
  }

  // i-pro-nvr: カメラ網が業務網から分離され、エッジから NVR にしか到達できない
  // 現場向けの構成。ライブ・録画とも NU-100 経由で取る。
  // vod.ts の対応表どおり、NVR は recorder.host / CH は camera.channel。
  if (!buf && camera.recorder.vendor === 'i-pro-nvr') {
    const r = camera.recorder
    const nvr = {
      endpoint: nvrEndpoint(r.host),
      username: r.username,
      password: r.password,
    }

    if (isPast) {
      const nvrFrame = await fetchIproNvrHistoricalFrame(nvr, camera.channel, targetMs)
      if (nvrFrame) { buf = nvrFrame; source = 'ipro-nvr-recording' }
    }

    // 録画が引けない場合（未フラッシュ・欠測・NVR 側の保持期間外）は現フレームで
    // 代替する。8 枚の並びに穴を開けるより、取得時刻付きの現フレームを残す方が
    // 被害報告の資料として使える。grid と同じ push.cgi の永続ストリームを使う。
    if (!buf) {
      try {
        buf = await captureIproNvrJpeg({ ...nvr, timeoutMs: 10_000 }, camera.channel)
        source = 'ipro-nvr-latest'
      } catch (e) {
        logger.debug(
          { err: (e as Error).message, channel: camera.channel },
          'bcp: i-PRO NVR live snapshot failed',
        )
      }
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
  offsets:        number[],
): Promise<number> {
  let successCount = 0

  for (const offsetMin of offsets) {
    const targetMs = alertIssuedMs + offsetMin * 60_000
    if (offsetMin >= 0) {
      // Future offsets: wait until the moment has *passed* (target + settle),
      // not the exact instant. This flips isPast=true so the NVR/Frigate
      // historical path captures the recorded frame — capturing live at the
      // instant has no valid source for NVR-backed onvif-generic cameras and
      // fails. See FUTURE_OFFSET_SETTLE_MS / investigate 2026-06-27.
      await waitUntil(captureAtMs(offsetMin, alertIssuedMs))
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
  // Per-store snapshot offsets (selected in /admin/bcp). Empty/undefined falls
  // back to DEFAULT_SNAPSHOT_OFFSETS. Fewer offsets → less storage/bandwidth/NVR load.
  const offsets = normalizeOffsets(cmd.offsets)
  // Deduplicate cameras (the legacy command structure has 1 clip per camera
  // already, but defensive in case it ever sends duplicates).
  const cameraIds = [...new Set(clips.map((c) => c.cameraId))]
  const totalCount = cameraIds.length * offsets.length

  if (cameraIds.length === 0) {
    logger.info({ eventId }, 'bcp: no cameras to snapshot')
    return { successCount: 0, totalCount: 0 }
  }

  logger.info(
    { eventId, cameras: cameraIds.length, offsets, snapshotsTotal: totalCount, alertIssued: clipFrom },
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
      return captureCameraTimeline(eventId, camera, alertIssuedMs, sem, offsets)
    }),
  )

  const successCount = results.reduce(
    (n, r) => n + (r.status === 'fulfilled' ? r.value : 0),
    0,
  )

  logger.info({ eventId, successCount, totalCount }, 'bcp: snapshot capture complete')

  // The poller / retrieve route insert placeholder bcp_clips rows
  // (offset_min IS NULL, upload_status='pending') *before* dispatching this
  // capture. This pass writes its own per-offset rows but never touched those
  // placeholders, so they lingered 'pending' forever — which kept the
  // bcp_check_clips_complete trigger from ever advancing the event to
  // 'clips_uploaded' (so the auto-PDF sweep and completion email never fired).
  // Remove the superseded placeholders so they don't block completion or
  // pollute the PDF. See investigate 2026-06-27 (event 1127abc5…).
  {
    const { error } = await getSupa()
      .from('bcp_clips')
      .delete()
      .eq('event_id', eventId)
      .is('offset_min', null)
    if (error) logger.warn({ err: error.message, eventId }, 'bcp: placeholder cleanup failed')
  }

  // Finalize the event status explicitly. A DELETE does not fire the
  // bcp_check_clips_complete trigger, so the edge is authoritative here:
  // any snapshot captured → 'clips_uploaded' (sweep → PDF + email); none → 'failed'.
  // Guarded to in-progress states so we never regress an event a manual
  // report run already advanced (which would re-trigger the sweep / email).
  {
    const { error } = await getSupa()
      .from('bcp_events')
      .update({ status: successCount > 0 ? 'clips_uploaded' : 'failed' })
      .eq('id', eventId)
      .in('status', ['pending', 'recording'])
    if (error) logger.warn({ err: error.message, eventId }, 'bcp: event finalize failed')
  }

  return { successCount, totalCount }
}
