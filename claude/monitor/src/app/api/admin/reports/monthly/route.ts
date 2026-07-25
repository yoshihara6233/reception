/**
 * POST /api/admin/reports/monthly — 月次レポートを手動確定（C）
 *
 * 操作中テナント（super_admin）/ 自テナント（tenant_admin）の指定年月を確定し、
 * スナップショット＋PDF を作る。store_manager 等は不可。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { resolveAdminContext } from '@/lib/tenant/acting'
import { finalizeMonthlyReport } from '@/lib/reports/finalize'

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
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const svc = createSupabaseService()
  const res = await finalizeMonthlyReport(svc, ctx.tenantId, parsed.data.ym, user.id)
  if (!res.ok) return NextResponse.json({ error: res.error ?? 'finalize_failed' }, { status: 500 })
  return NextResponse.json({ ok: true, ym: res.ym, pdfUrl: res.pdfUrl, storeCount: res.storeCount })
}
