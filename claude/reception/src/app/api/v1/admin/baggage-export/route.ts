import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const { searchParams } = req.nextUrl

  const statusFilter = searchParams.get('status') || ''
  const storeId      = searchParams.get('storeId') || ''
  const context      = searchParams.get('context') || ''
  const visitorName  = searchParams.get('visitorName') || ''
  const company      = searchParams.get('company') || ''
  const dateFrom     = searchParams.get('dateFrom') || ''
  const dateTo       = searchParams.get('dateTo') || ''
  const sortDir      = searchParams.get('sortDir') === 'asc' ? true : false

  const allowedStoreIds = ctx.role === 'store_manager' ? ctx.store_ids : null

  // Visitor/store sub-query
  let visitIdFilter: string[] | null = null
  if (visitorName || company || storeId || (allowedStoreIds && allowedStoreIds.length > 0)) {
    let visitorIds: string[] | null = null
    if (visitorName || company) {
      let vq = supabase.from('visitors').select('id').eq('tenant_id', ctx.tenant_id)
      if (visitorName) vq = vq.ilike('name', `%${visitorName}%`)
      if (company)     vq = vq.ilike('company', `%${company}%`)
      const { data: vd } = await vq
      visitorIds = (vd ?? []).map((v: { id: string }) => v.id)
      if (visitorIds.length === 0) {
        return new NextResponse('申告者,会社,店舗,種別,ステータス,申告内容,申告日時,審査日時\n', {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="baggage_${new Date().toISOString().slice(0, 10)}.csv"`,
          },
        })
      }
    }
    let visitsQ = supabase.from('visits').select('id').eq('tenant_id', ctx.tenant_id)
    if (visitorIds)                                    visitsQ = visitsQ.in('visitor_id', visitorIds)
    if (storeId)                                       visitsQ = visitsQ.eq('store_id', storeId)
    if (allowedStoreIds && allowedStoreIds.length > 0) visitsQ = visitsQ.in('store_id', allowedStoreIds)
    const { data: vsd } = await visitsQ
    visitIdFilter = (vsd ?? []).map((v: { id: string }) => v.id)
  }

  let query = supabase
    .from('baggage_declarations')
    .select(
      `id, context, declaration_text, status, staff_notes, reviewed_at, created_at,
       visits(id, check_in_at, stores(name), visitors(name, company))`,
    )
    .eq('tenant_id', ctx.tenant_id)
    .order('created_at', { ascending: sortDir })
    .limit(5000)

  if (statusFilter && statusFilter !== 'all') {
    query = query.eq('status', statusFilter)
  } else if (!statusFilter) {
    query = query.in('status', ['pending', 'flagged'])
  }
  if (context)       query = query.eq('context', context)
  if (dateFrom)      query = query.gte('created_at', dateFrom)
  if (dateTo)        query = query.lte('created_at', dateTo + 'T23:59:59')
  if (visitIdFilter) query = query.in('visit_id', visitIdFilter)

  const { data } = await query

  const STATUS_LABELS: Record<string, string> = {
    pending: '審査待ち', flagged: 'フラグ', cleared: '問題なし',
    approved: '承認', rejected: '却下',
  }
  const CONTEXT_LABELS: Record<string, string> = {
    checkin: '入室時', checkout: '退室時',
  }

  const escape = (s: string | null | undefined) => {
    if (!s) return ''
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const header = ['申告者', '会社', '店舗', '種別', 'ステータス', '申告内容', '申告日時', '審査日時']
  const rows = (data ?? []).map((d: Record<string, unknown>) => {
    const v = d.visits as Record<string, unknown> | null
    const visitor = v?.visitors as Record<string, string> | null
    const store   = v?.stores   as Record<string, string> | null
    return [
      escape(visitor?.name),
      escape(visitor?.company),
      escape(store?.name),
      escape(CONTEXT_LABELS[(d.context as string)] ?? (d.context as string)),
      escape(STATUS_LABELS[(d.status as string)] ?? (d.status as string)),
      escape(d.declaration_text as string),
      escape(d.created_at  ? new Date(d.created_at  as string).toLocaleString('ja-JP') : ''),
      escape(d.reviewed_at ? new Date(d.reviewed_at as string).toLocaleString('ja-JP') : ''),
    ].join(',')
  })

  const csv = '\uFEFF' + [header.join(','), ...rows].join('\n')

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="baggage_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
