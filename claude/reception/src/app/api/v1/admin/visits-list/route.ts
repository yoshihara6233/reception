import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

export const dynamic = 'force-dynamic'

type SortCol = 'check_in_at' | 'check_out_at' | 'status' | 'purpose'
const SORTABLE: SortCol[] = ['check_in_at', 'check_out_at', 'status', 'purpose']

export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = createAdminClient()
  const tenantId = ctx.tenant_id
  const { searchParams } = req.nextUrl

  const q        = searchParams.get('q')       || ''
  const company  = searchParams.get('company') || ''
  const status   = searchParams.get('status')  || ''
  const purpose  = searchParams.get('purpose') || ''
  const storeId  = searchParams.get('storeId') || ''
  const dateFrom = searchParams.get('dateFrom') || ''
  const dateTo   = searchParams.get('dateTo')   || ''
  const sortBy   = (searchParams.get('sortBy') || 'check_in_at') as SortCol
  const sortDir  = searchParams.get('sortDir') === 'asc'
  const page     = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const perPage  = 20

  const col = SORTABLE.includes(sortBy) ? sortBy : 'check_in_at'

  let query = supabase
    .from('visits')
    .select(
      'id, purpose, status, check_in_at, check_out_at, visitors(company, name, department), stores(id, name), baggage_declarations(id, status, context, inspection_mode)',
      { count: 'exact' }
    )
    .eq('tenant_id', tenantId)
    .order(col, { ascending: sortDir })
    .range((page - 1) * perPage, page * perPage - 1)

  if (status)   query = query.eq('status', status)
  if (storeId)  query = query.eq('store_id', storeId)

  if (dateFrom) {
    const from = new Date(dateFrom); from.setHours(0, 0, 0, 0)
    query = query.gte('check_in_at', from.toISOString())
  }
  if (dateTo) {
    const to = new Date(dateTo); to.setHours(23, 59, 59, 999)
    query = query.lte('check_in_at', to.toISOString())
  }

  const { data, count } = await query

  let visits = data ?? []

  // テキスト絞り込み（name / company / purpose をサーバー側フィルタで近似）
  if (q) {
    const lq = q.toLowerCase()
    visits = visits.filter((v: any) =>
      v.visitors?.name?.toLowerCase().includes(lq) ||
      v.visitors?.company?.toLowerCase().includes(lq)
    )
  }
  if (company) {
    const lc = company.toLowerCase()
    visits = visits.filter((v: any) => v.visitors?.company?.toLowerCase().includes(lc))
  }
  if (purpose) {
    const lp = purpose.toLowerCase()
    visits = visits.filter((v: any) => v.purpose?.toLowerCase().includes(lp))
  }

  return NextResponse.json({ visits, total: count ?? 0 })
}
