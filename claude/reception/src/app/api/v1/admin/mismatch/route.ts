/**
 * GET /api/v1/admin/mismatch?date=YYYY-MM-DD
 *
 * 指定日の全来訪記録をアンマッチ種別付きで返す。
 *
 * mismatch_type:
 *   normal            - 入室・退室ともに記録あり（正常）
 *   unmatched_checkin - 入室済みで退室記録なし（未退室 / auto_closed 含む）
 *   checkout_only     - 入室記録なしで退室（purpose = '__checkout_only__'）
 *
 * レスポンス:
 *   {
 *     date: "YYYY-MM-DD",
 *     visits: DailyVisit[],
 *     summary: { total, normal, unmatched_checkin, checkout_only }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

export const dynamic = 'force-dynamic'

const CHECKOUT_ONLY_PURPOSE = '__checkout_only__'

function classifyMismatch(
  status: string,
  purpose: string,
): 'normal' | 'unmatched_checkin' | 'checkout_only' {
  if (purpose === CHECKOUT_ONLY_PURPOSE) return 'checkout_only'
  if (status === 'checked_in' || status === 'auto_closed') return 'unmatched_checkin'
  return 'normal'
}

export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = createAdminClient()
  const tenantId = ctx.tenant_id

  const { searchParams } = req.nextUrl
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
  const dateParam = searchParams.get('date') ?? yesterday

  // 指定日の開始〜終了 (JST = UTC+9)
  const dayStart = new Date(`${dateParam}T00:00:00+09:00`).toISOString()
  const dayEnd   = new Date(`${dateParam}T23:59:59+09:00`).toISOString()

  const SELECT = `
    id, visitor_id, purpose, status, check_in_at, check_out_at,
    visitors(company, name, department),
    stores(id, name)
  `

  // ① check_in_at が指定日の通常来訪（checkout_only 除く）
  const { data: regularVisits } = await supabase
    .from('visits')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .gte('check_in_at', dayStart)
    .lte('check_in_at', dayEnd)
    .neq('purpose', CHECKOUT_ONLY_PURPOSE)
    .order('check_in_at', { ascending: true })

  // ② checkout_only：check_out_at が指定日
  const { data: coVisits } = await supabase
    .from('visits')
    .select(SELECT)
    .eq('tenant_id', tenantId)
    .eq('purpose', CHECKOUT_ONLY_PURPOSE)
    .gte('check_out_at', dayStart)
    .lte('check_out_at', dayEnd)
    .order('check_out_at', { ascending: true })

  const visits = [
    ...(regularVisits ?? []).map(v => ({
      ...v,
      mismatch_type: classifyMismatch(v.status, v.purpose),
    })),
    ...(coVisits ?? []).map(v => ({
      ...v,
      mismatch_type: 'checkout_only' as const,
    })),
  ]

  const summary = {
    total:             visits.length,
    normal:            visits.filter(v => v.mismatch_type === 'normal').length,
    unmatched_checkin: visits.filter(v => v.mismatch_type === 'unmatched_checkin').length,
    checkout_only:     visits.filter(v => v.mismatch_type === 'checkout_only').length,
  }

  return NextResponse.json({ date: dateParam, visits, summary })
}
