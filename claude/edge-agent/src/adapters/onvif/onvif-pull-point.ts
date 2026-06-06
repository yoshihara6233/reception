/**
 * F53.C: ONVIF PullPoint Event Subscription
 *
 * ONVIF イベント受信の最も基本的なパターン:
 *   1. CreatePullPointSubscription → 購読 URL を取得
 *   2. PullMessages (再帰的に poll) → イベントを取得
 *   3. Renew (定期、~5分ごと) → 購読 TTL を延長
 *   4. Unsubscribe (cleanup)
 *
 * ONVIF Topic → NvrEventType の正規化:
 *   tns1:VideoSource/MotionAlarm → motion
 *   tns1:VideoSource/SignalLoss  → video_loss
 *   tns1:RuleEngine/CellMotionDetector/Motion → motion
 *   tns1:RuleEngine/TamperDetector/Tamper → tampering
 *   tns1:RuleEngine/ObjectDetector/Object[Type=Human] → ai_person
 *   tns1:RuleEngine/ObjectDetector/Object[Type=Vehicle] → ai_vehicle
 */
import { createHash, randomBytes } from 'crypto'
import type { NvrEvent, NvrEventCallback, NvrEventSubscription, NvrEventType } from '@intereco/shared'

const NS_S    = 'http://www.w3.org/2003/05/soap-envelope'
const NS_TEV  = 'http://www.onvif.org/ver10/events/wsdl'
const NS_WSA  = 'http://www.w3.org/2005/08/addressing'

export interface PullPointOptions {
  endpoint:        string
  username:        string
  password:        string
  /** PullMessages のタイムアウト (秒)。デフォルト 60 秒で長期 poll */
  pullTimeoutSec?: number
  /** Subscription の TTL (秒)。デフォルト 600 秒 */
  initialTtlSec?:  number
  /** Renew 間隔 (秒)。デフォルト TTL の 1/3 */
  renewIntervalSec?: number
  timeoutMs?:      number
}

/** topic → 内部 event type 正規化 */
export function normalizeOnvifTopic(topic: string): NvrEventType | null {
  const t = topic.toLowerCase()
  if (t.includes('motion') || t.includes('cellmotion'))  return 'motion'
  if (t.includes('signalloss') || t.includes('videoloss')) return 'video_loss'
  if (t.includes('tamper'))                              return 'tampering'
  if (t.includes('person') || t.includes('human'))       return 'ai_person'
  if (t.includes('vehicle') || t.includes('car'))        return 'ai_vehicle'
  if (t.includes('audio'))                               return 'audio_anomaly'
  return null
}

/** PullPoint subscription を作って起動する */
export async function createPullPointSubscription(
  opts:     PullPointOptions,
  callback: NvrEventCallback,
): Promise<NvrEventSubscription> {
  const endpoint = opts.endpoint.replace(/\/+$/, '')
  const ttlSec   = opts.initialTtlSec ?? 600
  const renewMs  = (opts.renewIntervalSec ?? Math.floor(ttlSec / 3)) * 1000
  const pullSec  = opts.pullTimeoutSec ?? 60
  const timeoutMs = opts.timeoutMs ?? 10_000

  // 1. CreatePullPointSubscription
  const subscribeUrl = await doSubscribe(endpoint, opts.username, opts.password, ttlSec, timeoutMs)

  let running = true
  let renewTimer: NodeJS.Timeout | null = null
  let pullController: AbortController | null = null

  // 2. PullMessages を再帰的に poll
  const pullLoop = async (): Promise<void> => {
    while (running) {
      pullController = new AbortController()
      try {
        const events = await doPullMessages(
          subscribeUrl, opts.username, opts.password, pullSec, timeoutMs, pullController.signal,
        )
        for (const evt of events) {
          await callback(evt)
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') break
        // 一時エラー: 短い backoff のあと継続
        await new Promise((r) => setTimeout(r, 2000))
      } finally {
        pullController = null
      }
    }
  }
  void pullLoop()

  // 3. Renew を定期実行
  renewTimer = setInterval(() => {
    if (!running) return
    void doRenew(subscribeUrl, opts.username, opts.password, ttlSec, timeoutMs)
      .catch((err) => {
        // Renew 失敗は致命ではない: PullMessages が 404 等を返したら再 Subscribe
        console.warn('PullPoint renew failed:', (err as Error).message)
      })
  }, renewMs)

  return {
    unsubscribe: async () => {
      running = false
      if (renewTimer) clearInterval(renewTimer)
      if (pullController) pullController.abort()
      // 4. Unsubscribe (best-effort)
      await doUnsubscribe(subscribeUrl, opts.username, opts.password, timeoutMs).catch(() => {})
    },
  }
}

// ─── SOAP 呼び出しヘルパー ───────────────────────────────────────────────────

async function doSubscribe(
  endpoint: string, username: string, password: string,
  ttlSec: number, timeoutMs: number,
): Promise<string> {
  const body = `<tev:CreatePullPointSubscription xmlns:tev="${NS_TEV}">
    <tev:InitialTerminationTime>PT${ttlSec}S</tev:InitialTerminationTime>
  </tev:CreatePullPointSubscription>`
  const xml = await callSoap(
    `${endpoint}/onvif/Events`, body, username, password, timeoutMs,
    'http://www.onvif.org/ver10/events/wsdl/EventPortType/CreatePullPointSubscriptionRequest',
  )
  const m = xml.match(/<(?:wsa:)?Address>([^<]+)<\/(?:wsa:)?Address>/)
  if (!m) {
    throw new Error('ONVIF CreatePullPointSubscription: no SubscriptionReference Address')
  }
  return m[1]
}

async function doPullMessages(
  subscribeUrl: string, username: string, password: string,
  timeoutSec: number, baseTimeoutMs: number, signal: AbortSignal,
): Promise<NvrEvent[]> {
  const body = `<tev:PullMessages xmlns:tev="${NS_TEV}">
    <tev:Timeout>PT${timeoutSec}S</tev:Timeout>
    <tev:MessageLimit>20</tev:MessageLimit>
  </tev:PullMessages>`
  const xml = await callSoap(
    subscribeUrl, body, username, password,
    Math.max(baseTimeoutMs, (timeoutSec + 5) * 1000),
    'http://www.onvif.org/ver10/events/wsdl/PullPointSubscription/PullMessagesRequest',
    signal,
  )

  // NotificationMessage を順に抽出
  const events: NvrEvent[] = []
  const msgRe = /<(?:wsnt:)?NotificationMessage>([\s\S]*?)<\/(?:wsnt:)?NotificationMessage>/g
  let m: RegExpExecArray | null
  while ((m = msgRe.exec(xml))) {
    const inner = m[1]
    const topic = (inner.match(/<(?:wsnt:)?Topic[^>]*>([^<]+)<\/(?:wsnt:)?Topic>/) ?? [])[1] ?? ''
    const type = normalizeOnvifTopic(topic)
    if (!type) continue
    const channelMatch = inner.match(/(?:Source|VideoSourceConfigurationToken)[^>]*?Value="?(\d+)/)
    const channel = channelMatch ? parseInt(channelMatch[1], 10) : 1
    events.push({
      type,
      channel,
      occurredAt: new Date(),     // SUNAPI は wsnt:Message に utcTime もあるが、ここでは現在時刻
      receivedAt: new Date(),
      payload:    { topic, raw: inner.slice(0, 200) },
    })
  }
  return events
}

async function doRenew(
  subscribeUrl: string, username: string, password: string,
  ttlSec: number, timeoutMs: number,
): Promise<void> {
  const body = `<wsnt:Renew xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2">
    <wsnt:TerminationTime>PT${ttlSec}S</wsnt:TerminationTime>
  </wsnt:Renew>`
  await callSoap(
    subscribeUrl, body, username, password, timeoutMs,
    'http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/RenewRequest',
  )
}

async function doUnsubscribe(
  subscribeUrl: string, username: string, password: string, timeoutMs: number,
): Promise<void> {
  const body = `<wsnt:Unsubscribe xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2"/>`
  await callSoap(
    subscribeUrl, body, username, password, timeoutMs,
    'http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/UnsubscribeRequest',
  )
}

// ─── 共通 SOAP コール (WS-Security UsernameToken Digest) ─────────────────────

async function callSoap(
  url: string, body: string, username: string, password: string,
  timeoutMs: number, action: string, signal?: AbortSignal,
): Promise<string> {
  const wsse = buildWsseDigest(username, password)
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="${NS_S}" xmlns:wsa="${NS_WSA}">
  <s:Header>
    <wsa:Action>${action}</wsa:Action>
    <wsa:To>${url}</wsa:To>
    ${wsse}
  </s:Header>
  <s:Body>${body}</s:Body>
</s:Envelope>`
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  // 外部 signal もリッスン
  if (signal) {
    if (signal.aborted) ctl.abort()
    else signal.addEventListener('abort', () => ctl.abort(), { once: true })
  }
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'content-type': 'application/soap+xml; charset=utf-8' },
      body:    envelope,
      signal:  ctl.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`ONVIF SOAP HTTP ${res.status}: ${text.slice(0, 200)}`)
    }
    return text
  } finally {
    clearTimeout(timer)
  }
}

function buildWsseDigest(username: string, password: string): string {
  const nonce   = randomBytes(16)
  const created = new Date().toISOString()
  const sha1    = createHash('sha1')
  sha1.update(nonce)
  sha1.update(created)
  sha1.update(password)
  const digest  = sha1.digest('base64')
  const nonceB64 = nonce.toString('base64')
  return `<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">
  <wsse:UsernameToken>
    <wsse:Username>${escapeXml(username)}</wsse:Username>
    <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</wsse:Password>
    <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonceB64}</wsse:Nonce>
    <wsu:Created xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</wsu:Created>
  </wsse:UsernameToken>
</wsse:Security>`
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
