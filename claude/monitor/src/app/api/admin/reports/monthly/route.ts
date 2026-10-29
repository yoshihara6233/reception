/**
 * POST /api/admin/reports/monthly — 月次レポートを手動確定（C）
 *
 * 操作中テナント（super_admin）/ 自テナント（tenant_admin）の指定年月を確定し、
 * スナップショット＋PDF を作る。store_manager 等は不可。
 */
import { NextRequest, NextResponse } from 'next/server'
import { invalidInput } from '@/lib/api/invalid-input'
import { z } from 'zod'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { resolveAdminContext } from '@/lib/tenant/acting'
import { finalizeMonthlyReport } from '@/lib/reports/finalize'
import { heavyAllows, tooManyRequests } from '@/lib/limits/heavy'

export const runtime = 'nodejs'

const Body = z.object({ ym: z.string().regex(/^\d{4}-\d{2}$/) })

export async function POST(req: NextRequest) {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const ctx = await resolveAdminContext(supa)
  if (!ctx.role || !['super_admin', 'tenant_admin'].includes(ctx.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'tenant_required' }, { status: 400 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return invalidInput(req, { error: 'invalid_body' }, user.id)

  const svc = createSupabaseService()

  // 全拠点の集計と PDF を同期で作る。回数の上限 (利用者 60 秒 3 回・1 時間 30 回・
  // 同じテナント 60 秒 3 回・自主診断 ASVS 15.2.2)
  const allowed = await heavyAllows(svc, 'monthly-finalize', { user: user.id, tenant: ctx.tenantId })
  if (!allowed.ok) return tooManyRequests(allowed.retryAfterSec)

  try {
    const res = await finalizeMonthlyReport(svc, ctx.tenantId, parsed.data.ym, user.id)
    if (!res.ok) return NextResponse.json({ error: res.error ?? 'finalize_failed' }, { status: 500 })
    return NextResponse.json({ ok: true, ym: res.ym, pdfUrl: res.pdfUrl, storeCount: res.storeCount })
  } catch (e) {
    // 未捕捉例外の内容を返して原因を可視化する（500 の中身が見えるように）。
    return NextResponse.json({ error: `exception: ${String((e as Error)?.message ?? e)}` }, { status: 500 })
  }
}
