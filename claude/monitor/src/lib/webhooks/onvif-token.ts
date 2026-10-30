/**
 * ONVIF の Webhook の店舗ごとの鍵（自主診断 ASVS 2.2.3・2026-10-31）。
 *
 * 以前は全店舗で共通の秘密 ONVIF_WEBHOOK_SECRET を 1 本だけ照合していたので、その秘密を
 * 知っていれば、どの店舗 ID の受け口にも書き込めた（ある店舗の NVR の設定から秘密が漏れると、
 * 全店舗へ偽の障害を入れられる）。いまは共通の秘密を元の鍵にして、店舗 ID を混ぜた
 * 店舗ごとの鍵を作り、その店舗の受け口ではその鍵だけを受ける。DB は変えない
 * （鍵は元の鍵と店舗 ID から毎回同じものが作れる）。
 *
 *   店舗の鍵 = "ow1." + base64url(HMAC-SHA256(ONVIF_WEBHOOK_SECRET, "onvif-webhook:" + storeId))
 *
 * 元の鍵を作り直すと、全店舗の鍵が変わる（NVR の設定をやり直す）。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const PREFIX = 'ow1.'

/** 店舗の鍵を作る。元の鍵が無ければ null */
export function onvifWebhookToken(storeId: string, master = process.env.ONVIF_WEBHOOK_SECRET): string | null {
  if (!master) return null
  const mac = createHmac('sha256', master).update(`onvif-webhook:${storeId.toLowerCase()}`).digest('base64url')
  return PREFIX + mac
}

/** 届いた鍵がその店舗の鍵か（時間を揃えて比べる）。元の鍵が無ければ false */
export function verifyOnvifWebhookToken(
  storeId: string,
  provided: string,
  master = process.env.ONVIF_WEBHOOK_SECRET,
): boolean {
  const want = onvifWebhookToken(storeId, master)
  if (!want || !provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(want)
  return a.length === b.length && timingSafeEqual(a, b)
}
