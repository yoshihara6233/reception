import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createAdminClient()
  const tenantId = '00000000-0000-0000-0000-000000000001' // TODO: from auth
  const { searchParams } = req.nextUrl

  const q = searchParams.get('q') || ''
  const status = searchParams.get('status') || ''
  const date = searchParams.get('date') || ''
  const page = parseInt(searchParams.get('page') || '1')
  const perPage = 20

  let query = supabase
    .from('visits')
    .select(
      'id, purpose, status, check_in_at, check_out_at, visitors(company, name, department), stores(name)',
      { count: 'exact' }
    )
    .eq('tenant_id', tenantId)
    .order('check_in_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1)

  if (status) {
    query = query.eq('status', status)
  }
  if (date) {
    const start = new Date(date)
    const end = new Date(date)
    end.setDate(end.getDate() + 1)
    query = query.gte('check_in_at', start.toISOString()).lt('check_in_at', end.toISOString())
  }

  // Note: text search is basic (company/name filter done client-side for now)
  const { data, count } = await query

  let visits = data ?? []

  if (q) {
    const lq = q.toLowerCase()
    visits = visits.filter((v: any) =>
      v.visitors?.name?.toLowerCase().includes(lq) ||
      v.visitors?.company?.toLowerCase().includes(lq)
    )
  }

  return NextResponse.json({ visits, total: count ?? 0 })
}
