import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const { searchParams } = req.nextUrl

  const period = searchParams.get('period') || 'day'
  const storeId = searchParams.get('storeId') || ''
  const startDate = searchParams.get('startDate') || ''
  const endDate = searchParams.get('endDate') || ''

  // Determine truncation unit
  const truncUnit = period === 'month' ? 'month' : period === 'week' ? 'week' : 'day'

  // Build date range defaults if not provided
  const now = new Date()
  let defaultStart: Date
  if (period === 'month') {
    defaultStart = new Date(now)
    defaultStart.setMonth(now.getMonth() - 11)
    defaultStart.setDate(1)
  } else if (period === 'week') {
    defaultStart = new Date(now)
    defaultStart.setDate(now.getDate() - 12 * 7)
  } else {
    defaultStart = new Date(now)
    defaultStart.setDate(now.getDate() - 29)
  }

  const fromDate = startDate ? new Date(startDate) : defaultStart
  const toDate = endDate ? new Date(endDate) : now

  // Use raw SQL via rpc or manual approach
  // Supabase JS doesn't support DATE_TRUNC directly; use rpc or filter + JS grouping
  // We'll fetch all visits in range and group in JS for portability
  let query = supabase
    .from('visits')
    .select('check_in_at, store_id')
    .eq('tenant_id', ctx.tenant_id)
    .gte('check_in_at', fromDate.toISOString())
    .lte('check_in_at', toDate.toISOString())
    .not('check_in_at', 'is', null)

  if (storeId) {
    query = query.eq('store_id', storeId)
  }

  const { data, error } = await query

  if (error) {
    console.error('visits-trend error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Group by truncated date + store_id in JS
  const grouped: Record<string, Record<string, number>> = {}

  for (const row of data ?? []) {
    const d = new Date(row.check_in_at)
    let key: string
    if (truncUnit === 'month') {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    } else if (truncUnit === 'week') {
      // truncate to Monday
      const day = d.getDay()
      const diff = d.getDate() - day + (day === 0 ? -6 : 1)
      const monday = new Date(d)
      monday.setDate(diff)
      key = monday.toISOString().slice(0, 10)
    } else {
      key = d.toISOString().slice(0, 10)
    }
    const sid = row.store_id || 'all'
    if (!grouped[key]) grouped[key] = {}
    grouped[key][sid] = (grouped[key][sid] || 0) + 1
  }

  const result: { date: string; visit_count: number; store_id: string }[] = []
  for (const [date, stores] of Object.entries(grouped)) {
    for (const [sid, count] of Object.entries(stores)) {
      result.push({ date, visit_count: count, store_id: sid })
    }
  }

  result.sort((a, b) => a.date.localeCompare(b.date))

  return NextResponse.json({ data: result })
}
