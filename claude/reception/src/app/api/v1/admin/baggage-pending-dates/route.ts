/**
 * GET /api/v1/admin/baggage-pending-dates
 * 過去 N 日間の日付ごとの pending 件数を返す
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const days = parseInt(searchParams.get('days') || '30')

  // JST (+9h) 基準で N 日前の日付を算出
  const JST_OFFSET_MS = 9 * 60 * 60 * 1000
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const sinceStr = new Date(since.getTime() - JST_OFFSET_MS).toISOString().slice(0, 10) // UTC で N 日前の開始

  const supabase = createAdminClient()

  // pending 件のみ id + created_at だけ取得（写真 URL 不要）
  const { data, error } = await supabase
    .from('baggage_declarations')
    .select('id, created_at')
    .eq('tenant_id', ctx.tenant_id)
    .eq('status', 'pending')
    .gte('created_at', sinceStr)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // created_at を JST 日付 (YYYY-MM-DD) に変換して集計
  const countByDate: Record<string, number> = {}
  for (const row of data ?? []) {
    const jstDate = new Date(new Date(row.created_at).getTime() + JST_OFFSET_MS)
    const date = jstDate.toISOString().slice(0, 10) // JST の YYYY-MM-DD
    countByDate[date] = (countByDate[date] ?? 0) + 1
  }

  const dates = Object.entries(countByDate)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.date.localeCompare(a.date))

  return NextResponse.json({ dates })
}
