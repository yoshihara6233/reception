/**
 * 運用アラートの汎用 Webhook（是正5・通知の複線化）。
 *
 * env ALERT_WEBHOOK_URL が設定されていれば、エッジ死活などの運用アラートを
 * JSON POST で送る。メール（ALERT_EMAILS/Resend）と併用でき、どちらか一方でも
 * 届けば「夜間に誰も気づかない」を防げる。
 *
 * ペイロードは {text, content} の両キーを持つ — Slack Incoming Webhook は text、
 * Discord は content を読むため、URL を貼るだけで両対応。LINE 等は中継サービス
 * （Make/Zapier/GAS）の Webhook を指定する想定。
 *
 * best-effort: 失敗してもスローしない（呼び出し元の cron を止めない）。
 */

const TIMEOUT_MS = 5_000

export function opsWebhookConfigured(): boolean {
  return !!process.env.ALERT_WEBHOOK_URL
}

export async function sendOpsWebhook(text: string): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL
  if (!url) return false
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, content: text }),
      signal: ac.signal,
    })
    if (!res.ok) console.error('[ops/webhook] rejected:', res.status)
    return res.ok
  } catch (e) {
    console.error('[ops/webhook] send failed:', String(e))
    return false
  } finally {
    clearTimeout(timer)
  }
}
