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
 *   Frigate only. 他ベンダは Phase 8.5 で
 *   the existing NvrAdapter `exportVodMp4()` capability (already implemented
 *   for those vendors in F53/F55). Routing through the adapter layer is the
 *   next refactor.
 *
 * No ffmpeg
 *   We stream the response body straight to Storage. The Frigate clip.mp4
 *   endpoint already produces a fragmented MP4 that HTML5 video can seek
 *   inside; no re-mux needed.
 */
import { type SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from '../supabase.js'
import { logger } from '../logger.js'
import { config } from '../config.js'
import { downloadIproNvrMp4 } from '../adapters/i-pro/nvr-vod.js'
import { remuxFaststart, transcodeHevcToH264IfNeeded } from '../util/window-mp4.js'
import type { CameraDescriptor } from '../types.js'

// 中央クライアント（鍵ローテ同期対応）に委譲。
function getSupa(): SupabaseClient {
  return getSupabase()
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
  const rec = i.camera.recorder
  // i-PRO NVR から VOD を取れるケース:
  //  - onvif-generic カメラに vod_host(NVR) が設定されている (カメラ直+NVR VOD)
  //  - vendor='i-pro-nvr' (レコーダ経由。host が NVR そのもの)
  const isOnvifNvrVod = rec.vendor === 'onvif-generic' && !!rec.vod_host
  const isNvrVod = rec.vendor === 'i-pro-nvr'
  const useIproNvr = isOnvifNvrVod || isNvrVod
  if (rec.vendor !== 'frigate' && !useIproNvr) {
    throw new Error(
      `VOD unsupported: vendor=${rec.vendor} (frigate / onvif-generic+NVR / i-pro-nvr のみ対応)`,
    )
  }

  const startSec = Math.floor(Date.parse(i.fromIso) / 1000)
  const endSec   = Math.floor(Date.parse(i.toIso)   / 1000)

  // Frigate のみ事前にソースURLを確定 (i-PRO NVR は httpdl で都度取得)
  let frigateSrc = ''
  if (rec.vendor === 'frigate') {
    const frigateCam = i.camera.frigate_camera
    if (!frigateCam) throw new Error(`camera ${i.camera.id} has no frigate_camera mapping`)
    frigateSrc = `http://${rec.host}:${config.FRIGATE_API_PORT}/api/${frigateCam}/start/${startSec}/end/${endSec}/clip.mp4`
  }

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

      // 2. ソースMP4を取得（vendor別）。
      let buf: Buffer
      if (useIproNvr) {
        // i-PRO NVR: httpdl.cgi で録画MP4を取得（標準MP4・remux不要）。
        //  - onvif-generic+vod_host: NVR は vod_host、CH は vod_channel
        //  - i-pro-nvr:             NVR は recorder.host、CH は camera.channel
        const nvrEndpoint = isNvrVod
          ? (rec.host.startsWith('http') ? rec.host : `https://${rec.host}`)
          : rec.vod_host!
        const nvrUser = isNvrVod ? rec.username : (rec.vod_username ?? rec.username)
        const nvrPass = isNvrVod ? rec.password : (rec.vod_password ?? rec.password)
        const nvrChannel = isNvrVod ? i.camera.channel : (rec.vod_channel ?? i.camera.channel)
        logger.info({ clipId: i.clipId, nvrEndpoint, ch: nvrChannel, from: i.fromIso, to: i.toIso }, 'vod: fetching i-PRO NVR clip')
        buf = await downloadIproNvrMp4(
          { endpoint: nvrEndpoint, username: nvrUser, password: nvrPass, timeoutMs: 120_000 },
          nvrChannel,
          new Date(i.fromIso),
          new Date(i.toIso),
        )
        if (stopped) return
        // H.265カメラ(例: 101)の録画は HEVC → Chrome 再生不可。HEVC のみ H.264 へ変換。
        buf = await transcodeHevcToH264IfNeeded(buf, i.clipId)
        if (stopped) return
      } else {
        // Frigate: clip.mp4 を取得 → fragmented MP4 を faststart に remux。
        logger.info({ clipId: i.clipId, src: frigateSrc, from: i.fromIso, to: i.toIso }, 'vod: fetching frigate clip')
        const r = await fetch(frigateSrc, { signal: ctrl.signal })
        if (!r.ok) {
          const text = await r.text().catch(() => '')
          throw new Error(`frigate ${r.status}: ${text.slice(0, 200)}`)
        }
        const rawBuf = Buffer.from(await r.arrayBuffer())
        if (rawBuf.length < 1024) {
          throw new Error(`empty_clip (bytes=${rawBuf.length})`)
        }
        if (stopped) return
        const remuxStart = Date.now()
        buf = await remuxFaststart(rawBuf, i.clipId)
        logger.info(
          { clipId: i.clipId, rawBytes: rawBuf.length, remuxedBytes: buf.length, remuxMs: Date.now() - remuxStart },
          'vod: remuxed to faststart MP4',
        )
        if (stopped) return
      }

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
