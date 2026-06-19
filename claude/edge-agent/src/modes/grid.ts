/**
 * Grid Mode — JPEG snapshot polling.
 *
 * Fetches the latest still-image snapshot from each configured camera over
 * HTTP (Frigate: /api/<cam>/latest.jpg), composes a 4×4 mosaic with sharp,
 * and uploads the result to Supabase Storage as the grid JPEG. Cells that
 * have no working snapshot source (no camera assigned to that grid_pos, or
 * a vendor without HTTP snapshot support) render as a dark placeholder.
 *
 * Replaces the previous ffmpeg+xstack RTSP pipeline. That approach hit:
 *   - xstack warm-up: 10 s of identical frames after each restart
 *   - Frigate go2rtc main-stream instability
 *   - sub-stream stickiness on the same I-frame
 *   - heavy CPU + complicated filter graph
 * The snapshot path has none of those: every fetch is an independent HTTP
 * GET that returns a freshly-encoded JPEG. RTSP and ffmpeg stay only in
 * VOD mode where seeking from a precise instant matters.
 */
import sharp from 'sharp'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { snapshotUrl } from '../rtsp/url.js'
import { captureRtspKeyframe, injectRtspCreds } from '../rtsp/keyframe.js'
import { resolveOnvifRtspUrl } from '../adapters/onvif/onvif-rtsp.js'
import { uploadGridJpeg } from '../upload/storage.js'
import type { CameraDescriptor } from '../types.js'

const GRID_COLS = 4
const GRID_ROWS = 4
const SLOTS     = GRID_COLS * GRID_ROWS

type GridHandle = { stop: () => Promise<void> }

interface Slot {
  pos:     number
  camId:   string
  /** 1 セル分の JPEG を取得する。vendor ごとに HTTP snapshot か ffmpeg keyframe。 */
  capture: () => Promise<Buffer>
}

/**
 * ONVIF RTSP URL の解決結果をプロセス全体でキャッシュ。profile token は不変なので
 * grid 再起動 (start_grid 再送) のたびに GetProfiles/GetStreamUri をやり直さない。
 * key = `${host}:${channel}`、value = creds 入り RTSP URL。
 */
const ONVIF_RTSP_CACHE = new Map<string, string>()

/** onvif-generic 用のセル取得を構築 (ONVIF で RTSP URL を解決→ffmpeg で 1 フレーム) */
function buildOnvifCapture(cam: CameraDescriptor): () => Promise<Buffer> {
  const r = cam.recorder
  const endpoint = `http://${r.host}:${r.onvif_port ?? 80}`
  const key = `${r.host}:${cam.channel}`
  return async () => {
    let rtspUrl = ONVIF_RTSP_CACHE.get(key)
    if (!rtspUrl) {
      const base = await resolveOnvifRtspUrl(
        { endpoint, username: r.username, password: r.password, timeoutMs: 8000 },
        cam.channel,
      )
      rtspUrl = injectRtspCreds(base, r.username, r.password)
      ONVIF_RTSP_CACHE.set(key, rtspUrl)
    }
    return captureRtspKeyframe(rtspUrl, config.FFMPEG_BIN)
  }
}

export async function startGrid(cameras: CameraDescriptor[]): Promise<GridHandle> {
  const slots: Slot[] = []
  for (const cam of cameras) {
    if (cam.grid_pos < 0 || cam.grid_pos >= SLOTS) continue

    // ONVIF カメラ直: RTSP→ffmpeg keyframe (H.264/H.265 両対応)
    if (cam.recorder.vendor === 'onvif-generic') {
      slots.push({ pos: cam.grid_pos, camId: cam.id, capture: buildOnvifCapture(cam) })
      continue
    }

    // 既存: HTTP snapshot URL (Frigate 等)
    const url = snapshotUrl({
      vendor:        cam.recorder.vendor,
      host:          cam.recorder.host,
      port:          cam.recorder.rtsp_port,
      username:      cam.recorder.username,
      password:      cam.recorder.password,
      channel:       cam.channel,
      frigateCamera: cam.frigate_camera ?? undefined,
      frigateApiPort: config.FRIGATE_API_PORT,
    })
    if (!url) {
      logger.warn(
        { camera_id: cam.id, vendor: cam.recorder.vendor },
        'grid: vendor has no snapshot URL — slot will render dark',
      )
      continue
    }
    slots.push({
      pos:   cam.grid_pos,
      camId: cam.id,
      capture: async () => {
        const resp = await fetch(url)
        if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${url}`)
        return Buffer.from(await resp.arrayBuffer())
      },
    })
  }

  if (slots.length === 0) {
    throw new Error('grid: no cameras with a snapshot source configured')
  }

  // Pre-compute cell geometry once.
  const cellW = Math.floor(config.GRID_WIDTH  / GRID_COLS)
  const cellH = Math.floor(config.GRID_HEIGHT / GRID_ROWS)
  const fullW = cellW * GRID_COLS
  const fullH = cellH * GRID_ROWS

  // 直近に取得できたセル原画 (pos→JPEG)。一時的な取得失敗 (ffmpeg timeout 等) で
  // セルが暗転しないよう、最後の良いフレームを保持する。
  const lastBuf = new Map<number, Buffer>()

  // One iteration: fetch all snapshots in parallel, resize each to a cell,
  // composite onto a dark base, encode as JPEG, upload.
  async function iterate(): Promise<void> {
    const fetches = await Promise.allSettled(
      slots.map(async (s) => {
        const buf = await s.capture()
        return { pos: s.pos, buf }
      }),
    )

    let ok = 0
    for (const f of fetches) {
      if (f.status === 'fulfilled') {
        lastBuf.set(f.value.pos, f.value.buf)
        ok++
      } else {
        logger.debug({ reason: String(f.reason) }, 'grid: cell capture failed')
      }
    }

    const layers: sharp.OverlayOptions[] = []
    for (const s of slots) {
      const buf = lastBuf.get(s.pos)  // 今回失敗でも直近の良いフレームを使う
      if (!buf) continue
      const col = s.pos % GRID_COLS
      const row = Math.floor(s.pos / GRID_COLS)
      try {
        const cell = await sharp(buf)
          .resize(cellW, cellH, { fit: 'cover' })
          .jpeg()
          .toBuffer()
        layers.push({ input: cell, left: col * cellW, top: row * cellH })
      } catch (e) {
        logger.debug({ err: String(e), pos: s.pos }, 'grid: cell resize failed')
      }
    }

    // Dark base canvas; failed/missing cells stay dark.
    const composed = await sharp({
      create: {
        width: fullW,
        height: fullH,
        channels: 3,
        background: { r: 15, g: 23, b: 42 },  // slate-900 (matches old lavfi color)
      },
    })
      .composite(layers)
      .jpeg({ quality: 100 - config.GRID_JPEG_QUALITY * 3 })  // map old 1..31 → ~97..7
      .toBuffer()

    await uploadGridJpeg(composed)
    logger.debug({ ok, total: slots.length }, 'grid: frame uploaded')
  }

  logger.info({ slots: slots.length, cellW, cellH }, 'grid: starting snapshot loop')

  let stopped = false
  let busy    = false   // 多重起動ガード: 前回 iterate 完了前に次を走らせない
  const intervalMs = Math.max(1_000, Math.round(1_000 / config.GRID_FPS))
  function runIterate(): void {
    if (stopped || busy) return   // ONVIF+ffmpeg は数秒かかるので重複起動を防ぐ
    busy = true
    iterate()
      .catch((e) => logger.error({ err: String(e) }, 'grid: iterate failed'))
      .finally(() => { busy = false })
  }
  // Kick the first iteration immediately so the first frame appears within
  // one round-trip instead of after `intervalMs`.
  runIterate()
  const timer = setInterval(runIterate, intervalMs)

  return {
    async stop() {
      stopped = true
      clearInterval(timer)
      logger.info('grid: stopped')
    },
  }
}
