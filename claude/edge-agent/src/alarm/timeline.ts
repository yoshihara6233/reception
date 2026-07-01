/**
 * 発報前後スナップ（PB7）— 1 発報につき「店舗の全カメラ × 秒オフセット」の JPEG を
 * 録画から抽出し、cloud (/api/alarms/frames/ingest) へ 1 枚ずつ中継する。
 *
 * BCP のタイムライン撮影（modes/bcp.ts）を秒粒度・発報単位に再構成したもの。抽出の下請け
 * （Frigate 録画 / i-PRO NVR 録画 → ffmpeg 先頭フレーム）は recording-frame.ts を共有。
 *
 * タイミング: 各オフセット target=occurred+offset を「録画がフラッシュされてから」抽出したい。
 *   → target + SETTLE まで待ってから抽出する（BCP と同じ理由。NVR が該当秒を VOD 化する猶予
 *     ＋ isPast を確実に成立させ録画経路を使う）。負オフセット(-5s)も含め全点に適用するため、
 *     最初のフレームは概ね occurred+SETTLE、最後(+3分)は occurred+180s+SETTLE で揃う。
 *   発生時の即時ライブスナップは ingest 側（/api/alarms/ingest）が別途 1 枚保存済みなので、
 *     利用者はまず即時スナップを見つつ、前後タイムラインが数分かけて埋まる UX になる。
 *
 * エッジのコマンドループをブロックしないよう、index.ts からは await せず detached 起動する。
 */
import { Buffer } from 'node:buffer'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { Semaphore } from '../util/semaphore.js'
import { captureCameraJpeg } from '../security/snapshot.js'
import { fetchBcpSnapshot } from '../bcp-fetchers/index.js'
import {
  fetchFrigateHistoricalFrame,
  fetchIproNvrHistoricalFrame,
} from '../security/recording-frame.js'
import type { CameraDescriptor } from '../types.js'

const CONCURRENCY       = 4
const CAPTURE_TIMEOUT_MS = 30_000

export interface AlarmTimelineCommand {
  /** alarm_events.id */
  alarmId:    string
  /** ISO8601 — 発報時刻（T+0 基準） */
  occurredAt: string
  /** 取得オフセット（秒）。昇順想定。 */
  offsetsSec: number[]
  /** cloud frames ingest の絶対 URL */
  ingestUrl:  string
}

/** 指定 target 時刻の録画フレームを 1 枚取得する（BCP の source 選択と同ロジック）。 */
async function captureFrameAt(
  camera:   CameraDescriptor,
  targetMs: number,
  signal:   AbortSignal,
): Promise<{ buf: Buffer; source: string } | null> {
  const isPast = targetMs < Date.now() - 5_000

  // Frigate 録画から過去フレーム
  if (camera.recorder.vendor === 'frigate' && camera.frigate_camera && isPast) {
    const historical = await fetchFrigateHistoricalFrame(
      camera.recorder.host, config.FRIGATE_API_PORT, camera.frigate_camera, targetMs,
    )
    if (historical) return { buf: historical, source: 'frigate-recording' }
  }

  // i-PRO NVR（onvif-generic + vod_host=NVR）録画から過去フレーム
  if (camera.recorder.vendor === 'onvif-generic' && camera.recorder.vod_host && isPast) {
    const endpoint = camera.recorder.vod_host.startsWith('http')
      ? camera.recorder.vod_host
      : `https://${camera.recorder.vod_host}`
    const nvrFrame = await fetchIproNvrHistoricalFrame(
      {
        endpoint,
        username: camera.recorder.vod_username ?? camera.recorder.username,
        password: camera.recorder.vod_password ?? camera.recorder.password,
      },
      camera.recorder.vod_channel ?? camera.channel,
      targetMs,
    )
    if (nvrFrame) return { buf: nvrFrame, source: 'ipro-nvr-recording' }
  }

  // i-PRO / Uniview: 時刻指定スナップ（v3+ は ?time= で過去、v1/v2 は latest に劣化）
  if (camera.recorder.vendor === 'ipro' || camera.recorder.vendor === 'uniview') {
    try {
      const r = await fetchBcpSnapshot(camera, isPast ? new Date(targetMs) : null)
      if (r) {
        return {
          buf:    r.body,
          source: r.source === 'historical' ? `${camera.recorder.vendor}-historical` : `${camera.recorder.vendor}-latest`,
        }
      }
    } catch (e) {
      logger.debug({ err: (e as Error).message, vendor: camera.recorder.vendor }, 'alarm-frame: vendor snapshot failed')
    }
  }

  // フォールバック: 現フレーム（latest）。過去は撮れないが「無し」よりは良い。
  try {
    const { bytes, via } = await captureCameraJpeg(camera, signal)
    return { buf: Buffer.from(bytes), source: `latest-${via}` }
  } catch {
    return null
  }
}

/** 1 フレームを cloud へ multipart POST する。成否を返す。 */
async function ingestFrame(
  cmd:       AlarmTimelineCommand,
  cameraId:  string,
  offsetSec: number,
  frame:     { buf: Buffer; source: string },
  signal:    AbortSignal,
): Promise<boolean> {
  const form = new FormData()
  form.set('alarm_id',  cmd.alarmId)
  form.set('camera_id', cameraId)
  form.set('offset_sec', String(offsetSec))
  form.set('source', frame.source)
  form.set('image', new Blob([frame.buf], { type: 'image/jpeg' }), 'frame.jpg')
  const res = await fetch(cmd.ingestUrl, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + config.EDGE_DEVICE_TOKEN },
    body: form,
    signal,
  })
  return res.ok
}

/** 待機（既に過ぎていれば即時）。 */
function waitUntil(targetMs: number): Promise<void> {
  const delay = Math.max(0, targetMs - Date.now())
  if (delay === 0) return Promise.resolve()
  return new Promise((r) => setTimeout(r, delay))
}

/**
 * 発報タイムライン撮影の入口。全カメラ × 全オフセットを取得して cloud へ中継する。
 * 未 await（detached）で呼ばれる想定。例外は内部で握り潰しログのみ。
 */
export async function runAlarmTimelineCapture(
  cmd:     AlarmTimelineCommand,
  cameras: CameraDescriptor[],
): Promise<void> {
  const occurredMs = new Date(cmd.occurredAt).getTime()
  if (!Number.isFinite(occurredMs)) {
    logger.warn({ alarmId: cmd.alarmId, occurredAt: cmd.occurredAt }, 'alarm-timeline: bad occurred_at')
    return
  }
  const offsets = [...cmd.offsetsSec].sort((a, b) => a - b)
  if (!cameras.length || !offsets.length) {
    logger.info({ alarmId: cmd.alarmId, cameras: cameras.length }, 'alarm-timeline: nothing to capture')
    return
  }
  const settleMs = config.ALARM_FRAME_SETTLE_MS

  logger.info(
    { alarmId: cmd.alarmId, cameras: cameras.length, offsets, settleMs },
    'alarm-timeline: starting store-wide timeline capture',
  )

  const sem = new Semaphore(CONCURRENCY)
  let ok = 0
  let total = 0

  await Promise.allSettled(cameras.map(async (camera) => {
    for (const offsetSec of offsets) {
      const targetMs = occurredMs + offsetSec * 1_000
      // 録画フラッシュ猶予: target を過ぎてから抽出（負オフセットも含め全点に適用）。
      await waitUntil(targetMs + settleMs)

      total++
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), CAPTURE_TIMEOUT_MS)
      const t0 = Date.now()
      try {
        const frame = await sem.run(() => captureFrameAt(camera, targetMs, ac.signal))
        if (!frame) {
          logger.warn({ alarmId: cmd.alarmId, cam_id: camera.id, offsetSec }, 'alarm-timeline: no frame')
          continue
        }
        const posted = await ingestFrame(cmd, camera.id, offsetSec, frame, ac.signal)
        if (posted) {
          ok++
          logger.info(
            { alarmId: cmd.alarmId, cam_id: camera.id, offsetSec, bytes: frame.buf.length, ms: Date.now() - t0, source: frame.source },
            'alarm-timeline: frame ingested',
          )
        } else {
          logger.warn({ alarmId: cmd.alarmId, cam_id: camera.id, offsetSec }, 'alarm-timeline: ingest rejected')
        }
      } catch (e) {
        logger.warn({ err: String(e), alarmId: cmd.alarmId, cam_id: camera.id, offsetSec, aborted: ac.signal.aborted }, 'alarm-timeline: frame failed')
      } finally {
        clearTimeout(timer)
      }
    }
  }))

  logger.info({ alarmId: cmd.alarmId, ok, total }, 'alarm-timeline: capture complete')
}
