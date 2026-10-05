import 'server-only'
import { sendOpsWebhook } from '@/lib/ops/webhook'
import { sendEmail } from '@/lib/email/send'
import { KIND_LABEL, SOURCE_LABEL, type FeedbackKind, type FeedbackSource } from './schema'

/** 通知に載せる本文の長さ（基本設計 §3.5・依頼の決まり: 先頭 200 字） */
export const NOTIFY_BODY_CHARS = 200

/**
 * 「業務が止まる」の要望を運営へすぐ知らせる（基本設計 §3.5）。
 *
 * 経路は /api/edge/events と同じ運用アラート（ALERT_EMAILS・ALERT_WEBHOOK_URL）。
 * best-effort: 失敗しても受付（201）は返す。本文は伏せ字にした後のものを渡すこと。
 */
export async function notifyBlockingFeedback(p: {
  tenantName: string | null
  storeName: string | null
  source: FeedbackSource
  kind: FeedbackKind
  body: string
}): Promise<void> {
  const chars = [...p.body]
  const excerpt = chars.slice(0, NOTIFY_BODY_CHARS).join('') + (chars.length > NOTIFY_BODY_CHARS ? '…' : '')
  const where = [p.tenantName ?? '(テナント不明)', p.storeName].filter(Boolean).join(' / ')
  const text = `【G・VMS 要望・業務が止まる】${where}（${SOURCE_LABEL[p.source]}・${KIND_LABEL[p.kind]}）— ${excerpt}`
  const recipients = (process.env.ALERT_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  await Promise.allSettled([
    sendOpsWebhook(text),
    recipients.length
      ? sendEmail(recipients, `【G・VMS 要望・業務が止まる】${where}`, `<p>${esc(text)}</p><p>運営管理 → 要望ボードで確かめてください。</p>`)
      : Promise.resolve(),
  ])
}
