import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const { searchParams } = req.nextUrl
  const storeId = searchParams.get('storeId') || ''

  let query = supabase
    .from('visits')
    .select('purpose, check_in_at')
    .eq('tenant_id', ctx.tenant_id)
    .not('check_in_at', 'is', null)
    .not('purpose', 'is', null)

  if (storeId) {
    query = query.eq('store_id', storeId)
  }

  const { data, error } = await query

  if (error) {
    console.error('purpose-flow error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Query 1: Count by purpose
  const byPurpose: Record<string, number> = {}
  // Query 2: 7x24 grid (DOW 0=Sun x Hour 0-23)
  const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
  // Query 3: Count by hour
  const byHour: number[] = new Array(24).fill(0)

  for (const row of data ?? []) {
    const d = new Date(row.check_in_at)
    const purpose = row.purpose || 'other'
    byPurpose[purpose] = (byPurpose[purpose] || 0) + 1

    const dow = d.getDay() // 0=Sun
    const hour = d.getHours()
    grid[dow][hour] = (grid[dow][hour] || 0) + 1
    byHour[hour] = (byHour[hour] || 0) + 1
  }

  return NextResponse.json({
    by_purpose: Object.entries(byPurpose).map(([name, count]) => ({ name, count })),
    heatmap: grid,
    by_hour: byHour.map((count, hour) => ({ hour, count })),
  })
}
