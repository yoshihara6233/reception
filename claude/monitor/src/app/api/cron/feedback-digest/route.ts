/**
 * 要望の新着のまとめメール cron（1 日 1 回・基本設計 §3.5）。
 *
 * vercel.json: 23:30 UTC = 8:30 JST。前の日の 8:30 から今日の 8:30 までに届いた要望を、
 * 運用アラートと同じ宛先（ALERT_EMAILS・カンマ区切り）へ 1 通で送る。
 * 新着が 0 件の日・宛先が無いときは送らない。区切りは時計の 8:30 に揃える（digest.ts）。
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

export const dynamic = 'force-dynamic'

/** 1 日の新着として読む上限（1 拠点 1 日 50 件 × 多拠点でも足りる量。超えた分は件数に含めない） */
const READ_LIMIT = 2000

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const authed = req.headers.get('authorization') === `Bearer ${secret}`
    || req.headers.get('x-cron-secret') === secret
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const recipients = (process.env.ALERT_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
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
  if (error) return NextResponse.json({ error: 'list_failed', ...range }, { status: 500 })
  const items = (data ?? []) as DigestItem[]

  if (items.length === 0) return NextResponse.json({ ok: true, count: 0, mailed: false, ...range })
  if (recipients.length === 0) return NextResponse.json({ ok: true, count: items.length, mailed: false, skipped: 'no_recipients', ...range })

  const tenantIds = [...new Set(items.map((i) => i.tenant_id))]
  const storeIds = [...new Set(items.map((i) => i.store_id).filter((v): v is string => !!v))]
  const [tenants, stores, untouched] = await Promise.all([
    svc.from('tenants').select('id, name').in('id', tenantIds),
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
  if (!sent.ok) return NextResponse.json({ error: 'send_failed', count: items.length, ...range }, { status: 502 })
  return NextResponse.json({ ok: true, count: items.length, mailed: true, ...range })
}
