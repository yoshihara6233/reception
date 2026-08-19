/**
 * 発報前後スナップ（PB7）— 1 発報につき「店舗の全カメラ × 秒オフセット」の JPEG を取得し、
 * cloud (/api/alarms/frames/ingest) へ 1 枚ずつ中継する。
 *
 * 取得方式（軽さ・低遅延のためハイブリッド）:
 *   - 発報前（offset < 0, 例 -5秒）… 過去なので**録画から抽出**（時間は遡れない）。
 *       Frigate 録画 / i-PRO NVR 録画 → ffmpeg 先頭フレーム（recording-frame.ts を BCP と共有）。
 *       録画フラッシュ猶予として target+SETTLE まで待ってから抽出する。
 *   - 発生時以降（offset >= 0）… その瞬間に**ライブ JPEG を 1 枚取得**（captureCameraJpeg＝
 *       巡回と同経路: Frigate latest.jpg / ONVIF 直接 / go2rtc）。ffmpeg も NVR MP4 も不要で軽く、
 *       録画フラッシュ待ちが無いので +5秒の画像は実際に発報+5秒で得られる。
 *
 * つまり録画抽出は各カメラ「-5秒の 1 枚」だけ、残りは軽量ライブ取得。全体は最後(+3分)＝occurred+180s
 * 付近で揃う（-5秒だけは録画フラッシュ待ちのため occurred+SETTLE で埋まる）。
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

/** その瞬間のライブ JPEG を 1 枚取得する（発生時以降・軽量経路）。失敗時 null。 */
async function captureLiveFrame(
  camera: CameraDescriptor,
  signal: AbortSignal,
): Promise<{ buf: Buffer; source: string } | null> {
  try {
    const { bytes, via } = await captureCameraJpeg(camera, signal)
    return { buf: Buffer.from(bytes), source: `live-${via}` }
  } catch {
    return null
  }
}

/** 指定 target 時刻の録画フレームを 1 枚取得する（発報前・BCP の source 選択と同ロジック）。 */
async function captureRecordingFrame(
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

  // i-PRO カメラ直: 時刻指定スナップ（v3+ は ?time= で過去、v1/v2 は latest に劣化）
  if (camera.recorder.vendor === 'ipro') {
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
      const isPre = offsetSec < 0
      // 発報前(録画): フラッシュ猶予として target+SETTLE まで待つ。
      // 発生時以降(ライブ): その瞬間 target で軽量ライブ取得（フラッシュ待ち不要）。
      await waitUntil(isPre ? targetMs + settleMs : targetMs)

      // 再送・遅延ディスパッチ等で target を大きく過ぎている場合、「今のライブ」を
      // その時刻として保存すると嘘になる。過去は録画抽出経路（latest フォールバック付き）へ。
      const staleLive = !isPre && targetMs < Date.now() - 15_000
      const fromRecording = isPre || staleLive

      total++
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), CAPTURE_TIMEOUT_MS)
      const t0 = Date.now()
      try {
        const frame = await sem.run(() => fromRecording
          ? captureRecordingFrame(camera, targetMs, ac.signal)
          : captureLiveFrame(camera, ac.signal))
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
