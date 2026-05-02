/**
 * GET /api/v1/admin/mismatch?date=YYYY-MM-DD
 *
 * 指定日の入退室アンマッチを返す。
 *
 * アンマッチ種別:
 *   unmatched_checkin  - 入室済み (check_in_at が指定日) で退室記録がない
 *   checkout_only      - 入室記録なしで退室 (purpose = '__checkout_only__')
 *
 * レスポンス:
 *   {
 *     date: "YYYY-MM-DD",
 *     unmatched_checkin: Visit[],   // 未退室
 *     checkout_only:     Visit[],   // 退室のみ
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

// 入室記録なしで退室した visit を識別するマーカー (check-out/route.ts と同値)
const CHECKOUT_ONLY_PURPOSE = '__checkout_only__'

export async function GET(req: NextRequest) {
  const supabase = createAdminClient()
  const tenantId = '00000000-0000-0000-0000-000000000001' // TODO: from auth

  const { searchParams } = req.nextUrl
  // デフォルトは昨日（当日はまだ入室中の人がいるため）
  const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
  const dateParam = searchParams.get('date') ?? yesterday

  // 指定日の開始〜終了 (JST = UTC+9)
  const dayStart = new Date(`${dateParam}T00:00:00+09:00`).toISOString()
  const dayEnd   = new Date(`${dateParam}T23:59:59+09:00`).toISOString()

  // ── 未退室 (check_in_at が指定日 かつ 退室なし or auto_closed) ────────
  const { data: uncheckedOut } = await supabase
    .from('visits')
    .select(`
      id, visitor_id, purpose, status, check_in_at, check_out_at,
      visitors(company, name, department),
      stores(id, name)
    `)
    .eq('tenant_id', tenantId)
    .gte('check_in_at', dayStart)
    .lte('check_in_at', dayEnd)
    .in('status', ['checked_in', 'auto_closed'])
    .neq('purpose', CHECKOUT_ONLY_PURPOSE)
    .order('check_in_at', { ascending: true })

  // ── 退室のみ (checkout_only マーカー かつ check_out_at が指定日) ──────
  const { data: checkoutOnly } = await supabase
    .from('visits')
    .select(`
      id, visitor_id, purpose, status, check_in_at, check_out_at,
      visitors(company, name, department),
      stores(id, name)
    `)
    .eq('tenant_id', tenantId)
    .eq('purpose', CHECKOUT_ONLY_PURPOSE)
    .gte('check_out_at', dayStart)
    .lte('check_out_at', dayEnd)
    .order('check_out_at', { ascending: true })

  return NextResponse.json({
    date:              dateParam,
    unmatched_checkin: uncheckedOut ?? [],
    checkout_only:     checkoutOnly ?? [],
  })
}
