/**
 * F77 / Phase 8.4-B — VOD as Storage Direct upload.
 *
 * Replaces the legacy LiveKit WHIP pipeline. The flow is now:
 *   1. Browser POSTs /api/vod      → server creates a vod_clips row (status='queued')
 *      and forwards start_vod (with clip_id) to this edge.
 *   2. This handler fetches the source MP4 from Frigate (clip.mp4 HTTP export).
 *   3. Streams it into Supabase Storage at vod-clips/<storage_path>.
 *   4. Updates the vod_clips row to status='ready' with storage_path + bytes.
 *   5. Browser, which polls /api/vod/<clip_id>/status, sees ready and plays
 *      <video src="/api/vod/<clip_id>"> — native HTML5, no WebRTC.
 *
 * Vendor scope
 *   Frigate only. Uniview/Hikvision/Hanwha/etc. will join in Phase 8.5 via
 *   the existing NvrAdapter `exportVodMp4()` capability (already implemented
 *   for those vendors in F53/F55). Routing through the adapter layer is the
 *   next refactor.
 *
 * No ffmpeg
 *   We stream the response body straight to Storage. The Frigate clip.mp4
 *   endpoint already produces a fragmented MP4 that HTML5 video can seek
 *   inside; no re-mux needed.
 */
import { spawn } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../logger.js'
import { config } from '../config.js'
import type { CameraDescriptor } from '../types.js'

// Local Supabase client — mirrors the lazy-init pattern in modes/bcp.ts.
// Service-role for Storage uploads + vod_clips state updates.
let _supa: SupabaseClient | null = null
function getSupa(): SupabaseClient {
  if (!_supa) {
    _supa = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return _supa
}

/**
 * F79 — Re-encode a Frigate clip.mp4 into a browser-friendly MP4.
 *
 * Why re-encode instead of `-c copy`?
 *   Frigate's clip.mp4 has TWO problems that block HTML5 <video> playback:
 *
 *   1. **Fragmented MP4** (moov + many×moof/mdat) — the browser plays only
 *      the first segment and stops because plain <video src> can't follow
 *      moof headers without MSE.
 *   2. **Non-monotonic DTS** (decode timestamps repeat or go backwards) —
 *      the H.264 stream from go2rtc has irregular timing that, when copied
 *      verbatim, makes the decoder give up after the first frame. ffmpeg's
 *      analyzer reports ~150 "non monotonically increasing dts" warnings on
 *      a single 60 s clip. Result: browser shows the first frame frozen.
 *
 *   `-c copy` (zero re-encode) merges the fragments but PRESERVES the bad
 *   DTS, so the video still plays as a static frame. `-fflags +genpts`,
 *   `-vsync vfr/cfr`, `-bsf:v h264_mp4toannexb` all fail to repair it in
 *   copy mode because the original packets keep their broken DTS.
 *
 *   Re-encoding through libx264 -preset ultrafast costs ~1-3 s on the
 *   Beelink N150 for a 60 s clip and produces clean, strictly increasing
 *   timestamps that every browser plays correctly.
 *
 *   ffmpeg -i in.mp4 -c:v libx264 -preset ultrafast -crf 23 -profile:v main \
 *          -c:a copy -movflags +faststart -f mp4 out.mp4
 *
 * Returns the re-encoded bytes. Throws if ffmpeg exits non-zero or is missing.
 */
async function remuxFaststart(input: Buffer, clipId: string): Promise<Buffer> {
  const dir   = join(tmpdir(), 'intereco-edge-vod')
  await mkdir(dir, { recursive: true })
  const inPath  = join(dir, `${clipId}.in.mp4`)
  const outPath = join(dir, `${clipId}.out.mp4`)

  try {
    await writeFile(inPath, input)

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(config.FFMPEG_BIN, [
        '-hide_banner', '-loglevel', 'warning',
        '-i', inPath,
        // Video: re-encode through libx264 with ultrafast preset. Re-encoding
        // is required (not just remuxing) because Frigate's clip.mp4 ships
        // non-monotonic DTS that no copy-mode flag fixes. main profile keeps
        // the file widely compatible (avc1.4D...). crf 23 = visually
        // transparent at moderate bitrate.
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-profile:v', 'main',
        '-pix_fmt', 'yuv420p',
        // Audio: copy if present (Frigate sub stream usually has no audio).
        '-c:a', 'copy',
        // Container: faststart so moov sits before mdat for instant playback.
        '-movflags', '+faststart',
        '-f', 'mp4',
        '-y',
        outPath,
      ], { stdio: ['ignore', 'pipe', 'pipe'] })

      let stderr = ''
      proc.stderr?.on('data', (b: Buffer) => { stderr += b.toString() })
      proc.on('error', reject)
      proc.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`ffmpeg remux exit ${code}: ${stderr.slice(0, 300)}`))
      })
    })

    return await readFile(outPath)
  } finally {
    await unlink(inPath).catch(() => {})
    await unlink(outPath).catch(() => {})
  }
}

const BUCKET = 'vod-clips'

type VodHandle = { stop: () => Promise<void> }

export interface StartVodInput {
  camera:  CameraDescriptor
  fromIso: string
  toIso:   string
  /** F77: vod_clips row id the API created. We update it as we progress. */
  clipId:  string
  /** Fires when the upload completes (caller transitions FSM to idle). */
  onEnded?: () => void
  /** Fires when something fails terminally; caller goes to idle/error. */
  onError?: (reason: string) => void
}

export async function startVod(i: StartVodInput): Promise<VodHandle> {
  if (i.camera.recorder.vendor !== 'frigate') {
    throw new Error(
      `Phase 8.4-B VOD is Frigate-only; vendor=${i.camera.recorder.vendor} pending Phase 8.5 adapter integration`,
    )
  }

  // Frigate generates clip.mp4 on demand for any [start, end] window.
  //   GET http://<frigate>:5000/api/<camera>/start/<unix_s>/end/<unix_s>/clip.mp4
  const frigateCam = i.camera.frigate_camera
  if (!frigateCam) {
    throw new Error(`camera ${i.camera.id} has no frigate_camera mapping`)
  }
  const startSec = Math.floor(Date.parse(i.fromIso) / 1000)
  const endSec   = Math.floor(Date.parse(i.toIso)   / 1000)
  const src = `http://${i.camera.recorder.host}:${config.FRIGATE_API_PORT}/api/${frigateCam}/start/${startSec}/end/${endSec}/clip.mp4`

  // We treat this whole upload as one VodHandle. stop() aborts the fetch
  // mid-upload and marks the row failed.
  const ctrl = new AbortController()
  let stopped = false

  // Storage layout: cam_<id>/<from>_<to>.mp4 (UTC, no colons).
  const stamp = (s: string) => s.replace(/[-:.TZ]/g, '').slice(0, 14)
  const storagePath = `cam_${i.camera.id}/${stamp(i.fromIso)}_${stamp(i.toIso)}.mp4`

  // Kick off the work in the background. The state machine's `active` handle
  // is this VodHandle; the FSM keeps the edge in `vod` state until either
  // onEnded or onError fires.
  ;(async () => {
    const startedAt = Date.now()
    try {
      // 1. Mark uploading.
      await getSupa()
        .from('vod_clips')
        .update({ status: 'uploading', uploading_at: new Date().toISOString() })
        .eq('id', i.clipId)

      // 2. Fetch the Frigate MP4. Frigate may take 5-30s to assemble; allow it.
      logger.info({ clipId: i.clipId, src, from: i.fromIso, to: i.toIso }, 'vod: fetching frigate clip')
      const r = await fetch(src, { signal: ctrl.signal })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(`frigate ${r.status}: ${text.slice(0, 200)}`)
      }
      const rawBuf = Buffer.from(await r.arrayBuffer())
      if (rawBuf.length < 1024) {
        // Frigate returns a tiny MP4 box (~100 bytes) when no recording exists
        // for the window. Catch this so the user sees "録画なし" not "失敗".
        throw new Error(`empty_clip (bytes=${rawBuf.length})`)
      }

      if (stopped) return  // aborted between fetch and upload — bail

      // 2.5. F79 — Remux Frigate's fragmented MP4 (moov + 31×moof/mdat) into
      //      a standard MP4 (moov + 1×mdat). Without this, HTML5 <video>
      //      shows a static first frame because the browser can't follow the
      //      moof fragments served from a Range request. ffmpeg -c copy is
      //      near-free (~50 ms for a 60 s clip on a Beelink N150).
      const remuxStart = Date.now()
      const buf = await remuxFaststart(rawBuf, i.clipId)
      const remuxMs = Date.now() - remuxStart
      logger.info(
        { clipId: i.clipId, rawBytes: rawBuf.length, remuxedBytes: buf.length, remuxMs },
        'vod: remuxed to faststart MP4',
      )

      if (stopped) return  // re-check after remux

      // 3. Upload to Storage.
      const { error: upErr } = await getSupa().storage
        .from(BUCKET)
        .upload(storagePath, buf, {
          contentType: 'video/mp4',
          upsert:      true,
        })
      if (upErr) throw new Error(`storage_upload: ${upErr.message}`)

      // 4. Flip the row to ready.
      const elapsedSec = (Date.now() - startedAt) / 1000
      const { error: rowErr } = await getSupa()
        .from('vod_clips')
        .update({
          status:       'ready',
          storage_path: storagePath,
          bytes:        buf.length,
          // We can compute the actual window from Frigate's response if needed;
          // for now we assume requested == actual.
          actual_from:  i.fromIso,
          actual_to:    i.toIso,
          duration_sec: Math.max(0, (endSec - startSec)),
          ready_at:     new Date().toISOString(),
        })
        .eq('id', i.clipId)
      if (rowErr) logger.warn({ err: rowErr.message }, 'vod: ready update failed (non-fatal)')

      logger.info(
        { clipId: i.clipId, bytes: buf.length, elapsedSec, storagePath },
        'vod: upload complete',
      )
      i.onEnded?.()
    } catch (e) {
      if (stopped) return  // expected; caller already handled it
      const reason = (e as Error).message ?? String(e)
      logger.error({ err: reason, clipId: i.clipId }, 'vod: upload failed')
      try {
        await getSupa()
          .from('vod_clips')
          .update({ status: 'failed', error: reason.slice(0, 500) })
          .eq('id', i.clipId)
      } catch {
        // best-effort — the upload already failed; logging the row update
        // failure on top of it would be noise.
      }
      i.onError?.(reason)
    }
  })()

  return {
    async stop() {
      stopped = true
      ctrl.abort()
      logger.info({ clipId: i.clipId }, 'vod: stopped (user-initiated)')
    },
  }
}
