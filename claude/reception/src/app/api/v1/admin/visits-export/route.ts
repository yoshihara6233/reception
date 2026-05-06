import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const supabase = createAdminClient()
  const tenantId = ctx.tenant_id
  const { searchParams } = req.nextUrl

  const q = searchParams.get('q') || ''
  const status = searchParams.get('status') || ''
  const date = searchParams.get('date') || ''

  let query = supabase
    .from('visits')
    .select('id, purpose, status, check_in_at, check_out_at, visitors(company, department, name, phone, email), stores(name), areas(name)')
    .eq('tenant_id', tenantId)
    .order('check_in_at', { ascending: false })
    .limit(10000)

  if (status) query = query.eq('status', status)
  if (date) {
    const start = new Date(date)
    const end = new Date(date)
    end.setDate(end.getDate() + 1)
    query = query.gte('check_in_at', start.toISOString()).lt('check_in_at', end.toISOString())
  }

  const { data } = await query
  let visits = data ?? []

  if (q) {
    const lq = q.toLowerCase()
    visits = visits.filter((v: any) =>
      v.visitors?.name?.toLowerCase().includes(lq) ||
      v.visitors?.company?.toLowerCase().includes(lq)
    )
  }

  const statusLabels: Record<string, string> = {
    checked_in: '入室中',
    checked_out: '退室済み',
    auto_closed: '自動退室',
  }

  const header = ['ID', '氏名', '会社名', '部署', '電話', 'メール', '訪問目的', '店舗', 'エリア', 'ステータス', '入室時刻', '退室時刻']
  const rows = visits.map((v: any) => [
    v.id,
    v.visitors?.name ?? '',
    v.visitors?.company ?? '',
    v.visitors?.department ?? '',
    v.visitors?.phone ?? '',
    v.visitors?.email ?? '',
    v.purpose,
    (v.stores as any)?.name ?? '',
    (v.areas as any)?.name ?? '',
    statusLabels[v.status] ?? v.status,
    v.check_in_at ? new Date(v.check_in_at).toLocaleString('ja-JP') : '',
    v.check_out_at ? new Date(v.check_out_at).toLocaleString('ja-JP') : '',
  ])

  const csv = [header, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n')

  // BOM for Excel Japanese support
  const bom = '\uFEFF'

  return new NextResponse(bom + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="visits_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
