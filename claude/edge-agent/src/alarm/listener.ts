/**
 * 発報受け口（Phase B PB5・push型）。
 *
 * i-PRO カメラ/NVR の HTTP アラーム通知や外部 Webhook を LAN で受け、該当カメラの
 * スナップを撮って cloud /api/alarms/ingest へ中継する。動体検知は使わず、接点/通知のみ。
 *
 * 受信 URL 例（カメラ/NVR の HTTP 通知先に設定）:
 *   http://<beelink-lan-ip>:<ALARM_LISTEN_PORT>/alarm?cam=<camera_id>&src=ipro&type=input&token=<共有トークン>
 *   - cam   : recorder_cameras.id（省略時は送信元IP＝recorder.host で解決を試みる）
 *   - src   : ipro | nvr | webhook（既定 ipro）
 *   - type  : input | tamper | ...（既定 input）
 *   - key   : dedup_key（省略時は cam+type で自動＝接点バウンス抑制）
 *   - token : ALARM_SHARED_TOKEN 設定時は必須（X-Alarm-Token ヘッダでも可）。不一致は 401。
 * GET/POST どちらも可。即 200 を返し、撮影・中継は非同期。
 */
import { Buffer } from 'node:buffer'
import { createServer, type Server } from 'node:http'
import { config } from '../config.js'
import { logger } from '../logger.js'
import { captureCameraJpeg } from '../security/snapshot.js'
import { isAlarmTokenValid } from './token.js'
import { spoolAlarm, startAlarmSpoolRetry } from './spool.js'
import { classifySendResult, type SendOutcome, type SpooledAlarm } from './spool-core.js'
import type { CameraDescriptor } from '../types.js'

const CAPTURE_TIMEOUT_MS = 25_000

function normalizeIp(ip: string | undefined): string {
  if (!ip) return ''
  return ip.replace(/^::ffff:/, '')
}

/**
 * 発報 1 件を cloud /api/alarms/ingest へ送信し、結果を分類して返す。
 * occurred_at を必ず送る（スプール再送時に受信時刻を保存するため）。
 */
async function sendAlarmToCloud(entry: SpooledAlarm): Promise<SendOutcome> {
  const ingestUrl = `${config.MONITOR_URL}/api/alarms/ingest`
  const form = new FormData()
  form.set('source', entry.source)
  form.set('event_type', entry.event_type)
  form.set('dedup_key', entry.dedup_key)
  form.set('occurred_at', entry.occurred_at)
  if (entry.camera_id) form.set('camera_id', entry.camera_id)
  if (entry.image_b64) {
    form.set('image', new Blob([Buffer.from(entry.image_b64, 'base64')], { type: 'image/jpeg' }), 'alarm.jpg')
  }
  let status: number | null = null
  try {
    const res = await fetch(ingestUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + config.EDGE_DEVICE_TOKEN },
      body: form,
    })
    status = res.status
  } catch {
    status = null // ネットワーク断
  }
  return classifySendResult(status)
}

/** 受信した発報を撮影して ingest へ中継。失敗（transient）はスプールへ退避＝発報を失わない。 */
async function forwardAlarm(
  loadCameras: () => Promise<CameraDescriptor[]>,
  q: URLSearchParams,
  remoteIp: string,
): Promise<void> {
  const source     = (q.get('src') || 'ipro').trim()
  const eventType  = (q.get('type') || 'input').trim()
  const camId      = (q.get('cam') || '').trim()
  const dedupKey   = (q.get('key') || '').trim()
  const occurredAt = new Date().toISOString() // 受信時刻＝発報時刻（再送時もこの値で記録）

  const cams = await loadCameras()
  let cam: CameraDescriptor | undefined
  if (camId) cam = cams.find((c) => c.id === camId)
  if (!cam && remoteIp) cam = cams.find((c) => c.recorder.host === remoteIp)

  const key = dedupKey || `${cam?.id ?? (remoteIp || source)}:${eventType}`

  // カメラが解決できれば発報スナップを添付（失敗しても発報自体は記録する）。
  let imageB64: string | null = null
  if (cam) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), CAPTURE_TIMEOUT_MS)
    try {
      const { bytes, via } = await captureCameraJpeg(cam, ac.signal)
      imageB64 = Buffer.from(bytes).toString('base64')
      logger.info({ cam_id: cam.id, via, source, eventType }, 'alarm: captured snapshot')
    } catch (e) {
      logger.warn({ cam_id: cam.id, err: String(e) }, 'alarm: snapshot failed → 画像なしで記録')
    } finally {
      clearTimeout(timer)
    }
  } else {
    logger.warn({ camId, remoteIp }, 'alarm: カメラ未解決（画像なしで記録）')
  }

  const entry: SpooledAlarm = {
    source, event_type: eventType, camera_id: cam?.id ?? null,
    dedup_key: key, occurred_at: occurredAt, image_b64: imageB64, attempts: 0,
  }
  const outcome = await sendAlarmToCloud(entry)
  if (outcome === 'ok') {
    logger.info({ source, eventType, cam_id: cam?.id }, 'alarm: ingest ok')
  } else if (outcome === 'transient') {
    spoolAlarm(entry) // クラウド断/5xx → 退避して後で再送
  } else {
    logger.error({ source, eventType, cam_id: cam?.id }, 'alarm: ingest が恒久エラー応答（トークン/設定を確認）')
  }
}

/** 発報受け口を起動（ALARM_LISTEN_PORT>0 かつ MONITOR_URL 設定時のみ）。 */
export function startAlarmListener(loadCameras: () => Promise<CameraDescriptor[]>): { close: () => void } {
  const port = config.ALARM_LISTEN_PORT
  if (!port || !config.MONITOR_URL) {
    if (port && !config.MONITOR_URL) logger.warn('alarm: ALARM_LISTEN_PORT 設定済だが MONITOR_URL 未設定 → 受け口を起動しません')
    return { close: () => {} }
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`)
    if (url.pathname === '/' || url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); return
    }
    if (url.pathname !== '/alarm') { res.writeHead(404); res.end('not found'); return }

    const remoteIp = normalizeIp(req.socket.remoteAddress ?? undefined)
    if (!isAlarmTokenValid(config.ALARM_SHARED_TOKEN, url.searchParams, req.headers['x-alarm-token'])) {
      logger.warn({ remoteIp }, 'alarm: 共有トークン不一致 → 破棄（LAN内なりすましの可能性）')
      res.writeHead(401, { 'content-type': 'text/plain' }); res.end('unauthorized'); return
    }

    // 即 200（i-PRO 通知がタイムアウトしないよう）。撮影・中継は非同期。
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('accepted')
    void forwardAlarm(loadCameras, url.searchParams, remoteIp)
      .catch((e) => logger.warn({ err: String(e) }, 'alarm: forward failed'))
  })

  server.on('error', (e) => logger.error({ err: String(e), port }, 'alarm: listener error'))
  if (!config.ALARM_SHARED_TOKEN) {
    logger.warn('alarm: ALARM_SHARED_TOKEN 未設定 → 受け口は無認証で稼働（LAN内から偽発報が可能）。設定を推奨')
  }
  server.listen(port, '0.0.0.0', () => logger.info({ port, tokenRequired: !!config.ALARM_SHARED_TOKEN }, 'alarm: 発報受け口を起動（0.0.0.0）'))

  // クラウド断で退避した発報の再送ループ（受け口とライフサイクルを揃える）。
  const spoolRetry = startAlarmSpoolRetry(sendAlarmToCloud)

  return { close: () => { server.close(); spoolRetry.close() } }
}
