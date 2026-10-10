/**
 * 要望の新着のまとめメール cron（1 日 1 回・基本設計 §3.5）。
 *
 * vercel.json: 23:30 UTC = 8:30 JST。前の日の 8:30 から今日の 8:30 までに届いた要望を、
 * 要望の宛先（FEEDBACK_EMAILS・未設定なら運用アラートの ALERT_EMAILS・recipients.ts）へ 1 通で送る。
 * 新着が 0 件の日も「0 件」として送る（毎朝届くことで、集計と宛先が生きていると分かる・10/10 判断）。
 * 宛先が無いときは送らない。区切りは時計の 8:30 に揃える（digest.ts）。
 *
 * **毎回、件数・送ったか・宛先の数と出どころをログに残す**（宛先そのものは残さない）。
 * 10/9 に「INFO に来ない」とき、応答が 200 でも送ったのか・どこへ送ったのかを
 * Vercel のログから追えなかった。
 *
 * 認証: 他の cron と同じ CRON_SECRET（Bearer / x-cron-secret）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { sendEmail, SECURITY_FROM_ADDRESS } from '@/lib/email/send'
import { absoluteUrl } from '@/lib/app-url'
import { PRODUCT_NAME } from '@/lib/brand'
import { countUntouchedFeedback } from '@/lib/feedback/board'
import { digestWindow, renderDigest, type DigestItem } from '@/lib/feedback/digest'
import { feedbackRecipients } from '@/lib/feedback/recipients'

export const dynamic = 'force-dynamic'

/** 1 日の新着として読む上限（1 拠点 1 日 50 件 × 多拠点でも足りる量。超えた分は件数に含めない） */
const READ_LIMIT = 2000

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const authed = req.headers.get('authorization') === `Bearer ${secret}`
    || req.headers.get('x-cron-secret') === secret
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const to = feedbackRecipients()
  const recipients = to.emails
  const window = digestWindow(new Date())
  const range = { from: window.from.toISOString(), to: window.to.toISOString() }

  const svc = createSupabaseService()
  const { data, error } = await svc
    .from('feedback_items')
    .select('id, tenant_id, store_id, source, kind, urgency, body, created_at, page_url, attachment_type')
    .gte('created_at', range.from)
    .lt('created_at', range.to)
    .order('created_at', { ascending: true })
    .limit(READ_LIMIT)
  // 実行の結果をログに残す (件数・送ったか・宛先の数と出どころ)。宛先のアドレスは出さない
  const note = (r: Record<string, unknown>) =>
    console.info('[feedback-digest]', JSON.stringify({ ...r, ...range, recipients: recipients.length, recipientsFrom: to.source }))
  if (error) {
    note({ error: 'list_failed' })
    return NextResponse.json({ error: 'list_failed', ...range }, { status: 500 })
  }
  const items = (data ?? []) as DigestItem[]

  if (recipients.length === 0) {
    note({ count: items.length, mailed: false, skipped: 'no_recipients' })
    return NextResponse.json({ ok: true, count: items.length, mailed: false, skipped: 'no_recipients', ...range })
  }

  const tenantIds = [...new Set(items.map((i) => i.tenant_id))]
  const storeIds = [...new Set(items.map((i) => i.store_id).filter((v): v is string => !!v))]
  const [tenants, stores, untouched] = await Promise.all([
    tenantIds.length ? svc.from('tenants').select('id, name').in('id', tenantIds) : Promise.resolve({ data: [] }),
    storeIds.length ? svc.from('stores').select('id, name').in('id', storeIds) : Promise.resolve({ data: [] }),
    countUntouchedFeedback(svc),
  ])
  const names = (rows: unknown) => new Map(((rows ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]))

  const { subject, html } = renderDigest({
    items,
    tenantNames: names(tenants.data),
    storeNames: names(stores.data),
    untouched: untouched ?? 0,
    window,
    boardUrl: absoluteUrl('/admin/feedback'),
    productName: PRODUCT_NAME,
  })
  const sent = await sendEmail(recipients, subject, html, undefined, SECURITY_FROM_ADDRESS)
  if (!sent.ok) {
    note({ count: items.length, mailed: false, error: 'send_failed' })
    return NextResponse.json({ error: 'send_failed', count: items.length, ...range }, { status: 502 })
  }
  note({ count: items.length, mailed: true })
  return NextResponse.json({ ok: true, count: items.length, mailed: true, ...range })
}
