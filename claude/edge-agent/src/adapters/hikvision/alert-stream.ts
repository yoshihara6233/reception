/**
 * F55.E: Hikvision Alert Stream Event Push
 *
 * /ISAPI/Event/notification/alertStream を long-poll してイベントを受信。
 *
 * 仕様:
 *   - HTTP GET で永続接続を張る
 *   - レスポンスは multipart/mixed; boundary=MIME_boundary 形式の chunked
 *   - 各 part に XML 形式のイベントが入る:
 *     <EventNotificationAlert>
 *       <ipAddress>...</ipAddress>
 *       <eventType>VMD</eventType>             ← VMD=Motion, videoloss, tamperdetection
 *       <channelID>1</channelID>
 *       <dateTime>2026-06-04T10:00:00+09:00</dateTime>
 *       ...
 *     </EventNotificationAlert>
 *
 * 接続が切れた場合は backoff 付きで自動再接続。
 */
import type { NvrEvent, NvrEventCallback, NvrEventSubscription, NvrEventType } from '@intereco/shared'
import { logger } from '../../logger.js'

export interface AlertStreamOptions {
  endpoint:    string                 // https://host:port
  username:    string
  password:    string
  /** 切断後の再接続 backoff (ms)。デフォルト [1000, 2000, 5000, 10000] */
  reconnectBackoffMs?: number[]
}

const TOPIC_MAP: Array<{ pattern: RegExp; type: NvrEventType }> = [
  { pattern: /VMD|MotionDetection|motion/i,   type: 'motion' },
  { pattern: /videoloss|video.?loss/i,        type: 'video_loss' },
  { pattern: /tamper/i,                       type: 'tampering' },
  { pattern: /person|human|humanrecognition/i, type: 'ai_person' },
  { pattern: /vehicle|car|vehicleplate/i,     type: 'ai_vehicle' },
]

function normalizeHikvisionEventType(eventType: string): NvrEventType | null {
  for (const { pattern, type } of TOPIC_MAP) {
    if (pattern.test(eventType)) return type
  }
  return null
}

export async function subscribeHikvisionAlertStream(
  opts:     AlertStreamOptions,
  callback: NvrEventCallback,
): Promise<NvrEventSubscription> {
  const backoffs = opts.reconnectBackoffMs ?? [1000, 2000, 5000, 10000]
  let running = true
  let backoffIdx = 0
  let abortController: AbortController | null = null

  const loop = async (): Promise<void> => {
    while (running) {
      abortController = new AbortController()
      try {
        await runOnce(opts, callback, abortController.signal)
        // 正常終了は通常起きない (永続接続) が、起きたら短い backoff で再接続
        backoffIdx = 0
      } catch (err) {
        if ((err as Error).name === 'AbortError') break   // unsubscribe
        logger.warn(
          { err: (err as Error).message, backoff: backoffs[backoffIdx] },
          'Hikvision alertStream disconnected, will reconnect',
        )
      }
      if (!running) break
      const wait = backoffs[Math.min(backoffIdx, backoffs.length - 1)]
      await new Promise((r) => setTimeout(r, wait))
      backoffIdx = Math.min(backoffIdx + 1, backoffs.length - 1)
    }
  }
  void loop()

  return {
    unsubscribe: async () => {
      running = false
      if (abortController) abortController.abort()
    },
  }
}

async function runOnce(
  opts:     AlertStreamOptions,
  callback: NvrEventCallback,
  signal:   AbortSignal,
): Promise<void> {
  const url = `${opts.endpoint.replace(/\/+$/, '')}/ISAPI/Event/notification/alertStream`
  const auth = 'Basic ' + Buffer.from(`${opts.username}:${opts.password}`).toString('base64')

  const res = await fetch(url, {
    headers: { authorization: auth },
    signal,
  })
  if (!res.ok) {
    throw new Error(`alertStream HTTP ${res.status}`)
  }
  if (!res.body) {
    throw new Error('alertStream: no response body')
  }

  // multipart/mixed; boundary=...
  const contentType = res.headers.get('content-type') ?? ''
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i)
  const boundary = boundaryMatch ? boundaryMatch[1].replace(/^"|"$/g, '') : 'MIME_boundary'

  // ストリームを行単位でパース
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    if (signal.aborted) break

    buffer += decoder.decode(value, { stream: true })

    // boundary で分割して各 part を処理
    const parts = buffer.split(`--${boundary}`)
    // 最後の part はまだ未完了の可能性があるので buffer に残す
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      const eventXml = part.trim()
      if (!eventXml) continue
      const evt = parseHikvisionEventXml(eventXml)
      if (evt) {
        try {
          await callback(evt)
        } catch (err) {
          logger.warn({ err: (err as Error).message }, 'alertStream callback failed')
        }
      }
    }
  }
}

function parseHikvisionEventXml(text: string): NvrEvent | null {
  // ヘッダ部 (Content-Type 等) と XML 本文を分離
  const xmlStart = text.indexOf('<EventNotificationAlert')
  if (xmlStart === -1) return null
  const xml = text.slice(xmlStart)

  const eventType = (xml.match(/<eventType>([^<]+)<\/eventType>/) ?? [])[1] ?? ''
  const type = normalizeHikvisionEventType(eventType)
  if (!type) return null

  const channelStr = (xml.match(/<channelID>([^<]+)<\/channelID>/) ?? [])[1]
  const channel = channelStr ? parseInt(channelStr, 10) : 1
  const dateTimeStr = (xml.match(/<dateTime>([^<]+)<\/dateTime>/) ?? [])[1]
  const occurredAt = dateTimeStr ? new Date(dateTimeStr) : new Date()

  return {
    type,
    channel,
    occurredAt: isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    receivedAt: new Date(),
    payload:    { eventType, raw: xml.slice(0, 400) },
  }
}
