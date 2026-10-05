/**
 * /api/feedback — クラウドの画面から送る要望（基本設計 §3.1・テナント管理者だけ）
 *
 * POST: 要望 1 件を送る（source=cloud）。
 *   201 { id } / 400 invalid_body / 401 / 403 forbidden（tenant_admin 以外）/
 *   409 feedback_disabled（テナントが止めている）/ 429 daily_limit（1 人 1 日 20 件）
 * GET:  自分のテナントの要望の一覧（状態・返事・対応した版）。RLS 配下のセッションで読む。
 *
 * super_admin は運営の側なので送らない（要望ボードで扱う）。store_manager・viewer も送れない。
 * 本文は現場の受け口と同じく伏せ字にしてから保存する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { CloudFeedbackBody, USER_DAILY_LIMIT, jstDayStartIso, sanitizeContext } from '@/lib/feedback/schema'
import { redactFeedbackText } from '@/lib/feedback/redact'
import { loadTenantFeedbackFlag, readJsonBody } from '@/lib/feedback/intake'
import { notifyBlockingFeedback } from '@/lib/feedback/notify'

export const dynamic = 'force-dynamic'

const LIST_LIMIT = 200

export async function POST(req: NextRequest) {
  const guard = await requireTenantAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const tenantId = guard.profile.tenant_id
  if (!tenantId) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const raw = await readJsonBody(req)
  if (!raw.ok) return NextResponse.json({ error: raw.error }, { status: raw.status })
  const parsed = CloudFeedbackBody.safeParse(raw.value)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const b = parsed.data

  // ガードを通ってから service role を組み立てる（書き込みポリシーは置いていない）。
  const svc = createSupabaseService()

  const tenant = await loadTenantFeedbackFlag(svc, tenantId)
  if (!tenant) return NextResponse.json({ error: 'tenant_lookup_failed' }, { status: 500 })
  if (!tenant.enabled) return NextResponse.json({ error: 'feedback_disabled' }, { status: 409 })

  const { count, error: countErr } = await svc
    .from('feedback_items')
    .select('id', { count: 'exact', head: true })
    .eq('submitted_by', guard.user.id)
    .gte('created_at', jstDayStartIso())
  if (countErr) return NextResponse.json({ error: 'count_failed' }, { status: 500 })
  if ((count ?? 0) >= USER_DAILY_LIMIT) return NextResponse.json({ error: 'daily_limit' }, { status: 429 })

  const body = redactFeedbackText(b.body)
  const { data: ins, error: insErr } = await svc
    .from('feedback_items')
    .insert({
      tenant_id: tenantId,
      store_id: null,
      edge_id: null,
      source: 'cloud',
      local_id: null,
      submitted_by: guard.user.id,
      kind: b.kind,
      urgency: b.urgency,
      body,
      contact_ok: b.contact_ok,
      role: 'tenant_admin',
      context: sanitizeContext(b.context),
      submitted_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (insErr || !ins) return NextResponse.json({ error: 'insert_failed' }, { status: 500 })

  if (b.urgency === 'blocking') {
    await notifyBlockingFeedback({ tenantName: tenant.name, storeName: null, source: 'cloud', kind: b.kind, body })
  }

  return NextResponse.json({ id: (ins as { id: string }).id }, { status: 201 })
}

export async function GET() {
  const guard = await requireTenantAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const tenantId = guard.profile.tenant_id
  if (!tenantId) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  // RLS（feedback_items_select: tenant_admin は自分のテナントだけ）の上で、さらにテナントで絞る。
  const { data, error } = await guard.supa
    .from('feedback_items')
    .select('id, source, store_id, kind, urgency, body, contact_ok, status, reply, fixed_version, submitted_at, created_at, updated_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT)
  if (error) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  return NextResponse.json({ items: data ?? [] }, { headers: { 'cache-control': 'no-store' } })
}
