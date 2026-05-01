import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'
import type { SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

// ── 型 ────────────────────────────────────────────────────────────────────────

export interface StoreRankItem {
  store_id: string
  store_name: string
  value: number
  prev_value: number
  total?: number
  delta_pct?: number
}

export interface DashboardAlert {
  id: string
  level: 'red' | 'yellow'
  store_id: string | null
  store_name: string | null
  type: string
  message: string
  value?: number
}

export interface DashboardStats {
  today: {
    current_visitors: number
    today_visits: number
    pending_baggage: number
    long_stay_count: number
    long_stay_visitors: { id: string; name: string; company: string; store: string; hours: number }[]
  }
  alerts: DashboardAlert[]
  rankings: {
    visits: StoreRankItem[]
    inspection_rate: StoreRankItem[]
    pending_baggage: StoreRankItem[]
    unmatch_rate: StoreRankItem[]
  }
  period: string
}

// ── ヘルパー ──────────────────────────────────────────────────────────────────

function getPeriodRange(period: string) {
  const now = new Date()
  const today = new Date(now); today.setHours(0, 0, 0, 0)

  if (period === 'today') {
    const prevFrom = new Date(today); prevFrom.setDate(today.getDate() - 1)
    return { cur: { from: today, to: now }, prev: { from: prevFrom, to: new Date(today) } }
  }
  if (period === 'month') {
    const curFrom  = new Date(now.getFullYear(), now.getMonth(), 1)
    const prevFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const prevTo   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    return { cur: { from: curFrom, to: now }, prev: { from: prevFrom, to: prevTo } }
  }
  // week (default)
  const curFrom  = new Date(today); curFrom.setDate(today.getDate() - 6)
  const prevFrom = new Date(curFrom); prevFrom.setDate(curFrom.getDate() - 7)
  return { cur: { from: curFrom, to: now }, prev: { from: prevFrom, to: new Date(curFrom) } }
}

function countByStore(rows: { store_id: string }[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const r of rows) m[r.store_id] = (m[r.store_id] ?? 0) + 1
  return m
}

function uniqueVisitsByStore(rows: { visit_id?: string; visits?: { store_id: string } | { store_id: string }[] }[]): Record<string, number> {
  const seen = new Set<string>()
  const m: Record<string, number> = {}
  for (const r of rows) {
    if (!r.visit_id) continue
    const visits  = r.visits
    const storeId = Array.isArray(visits) ? visits[0]?.store_id : visits?.store_id
    if (!storeId || seen.has(r.visit_id)) continue
    seen.add(r.visit_id)
    m[storeId] = (m[storeId] ?? 0) + 1
  }
  return m
}

function baggageByStore(rows: { visits?: { store_id: string } | { store_id: string }[] }[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const r of rows) {
    const visits  = r.visits
    const storeId = Array.isArray(visits) ? visits[0]?.store_id : visits?.store_id
    if (!storeId) continue
    m[storeId] = (m[storeId] ?? 0) + 1
  }
  return m
}

function deltaPct(cur: number, prev: number) {
  if (prev === 0) return cur > 0 ? 100 : 0
  return Math.round(((cur - prev) / prev) * 100)
}

// Conditional scope helper — applies .in() only when storeScope is non-null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scoped<T extends ReturnType<SupabaseClient['from']>>(q: any, storeScope: string[] | null): any {
  return storeScope ? q.in('store_id', storeScope) : q
}

// ── ハンドラ ──────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createAdminClient()
  const { tenant_id } = ctx
  const period = req.nextUrl.searchParams.get('period') || 'week'
  const { cur, prev } = getPeriodRange(period)

  const storeScope: string[] | null =
    ctx.role === 'store_manager' && ctx.store_ids.length > 0 ? ctx.store_ids : null

  // ── TODAY ─────────────────────────────────────────────────────────────────
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)

  const currentQ = scoped(
    supabase.from('visits').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant_id).eq('status', 'checked_in'),
    storeScope
  )
  const todayQ = scoped(
    supabase.from('visits').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant_id).gte('check_in_at', todayStart.toISOString()),
    storeScope
  )
  const pendingQ = scoped(
    supabase.from('baggage_declarations').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenant_id).in('status', ['pending', 'flagged']),
    storeScope
  )

  const [currentRes, todayRes, pendingRes] = await Promise.all([currentQ, todayQ, pendingQ])

  // 長時間滞在（4時間超）
  const longStayCutoff = new Date(Date.now() - 4 * 3600_000)
  const longStayQ = scoped(
    supabase.from('visits')
      .select('id, check_in_at, visitors(name, company), stores(name)')
      .eq('tenant_id', tenant_id).eq('status', 'checked_in')
      .lte('check_in_at', longStayCutoff.toISOString())
      .order('check_in_at', { ascending: true }).limit(20),
    storeScope
  )
  const longStayRes = await longStayQ

  const longStayVisitors = (longStayRes.data ?? []).map((v: Record<string, unknown>) => {
    const visitor = v.visitors as Record<string, string> | null
    const store   = v.stores   as Record<string, string> | null
    return {
      id: v.id as string,
      name: visitor?.name ?? '—',
      company: visitor?.company ?? '—',
      store: store?.name ?? '—',
      hours: Math.floor((Date.now() - new Date(v.check_in_at as string).getTime()) / 3600_000),
    }
  })

  // ── 店舗一覧 ───────────────────────────────────────────────────────────────
  let storesQ = supabase.from('stores').select('id, name')
    .eq('tenant_id', tenant_id).eq('is_active', true).order('name')
  if (storeScope) storesQ = storesQ.in('id', storeScope)
  const { data: storesData } = await storesQ
  const stores = storesData ?? []

  // ── ランキング用データ ─────────────────────────────────────────────────────

  const [vcCur, vcPrev, bgCur, bgPrev, pendingAll, umCur, umPrev] = await Promise.all([
    // 来訪数
    scoped(supabase.from('visits').select('store_id').eq('tenant_id', tenant_id)
      .gte('check_in_at', cur.from.toISOString()).lte('check_in_at', cur.to.toISOString()), storeScope),
    scoped(supabase.from('visits').select('store_id').eq('tenant_id', tenant_id)
      .gte('check_in_at', prev.from.toISOString()).lte('check_in_at', prev.to.toISOString()), storeScope),
    // 手荷物（来訪単位でユニーク）
    supabase.from('baggage_declarations').select('visit_id, visits!inner(store_id)')
      .eq('tenant_id', tenant_id)
      .gte('created_at', cur.from.toISOString()).lte('created_at', cur.to.toISOString()),
    supabase.from('baggage_declarations').select('visit_id, visits!inner(store_id)')
      .eq('tenant_id', tenant_id)
      .gte('created_at', prev.from.toISOString()).lte('created_at', prev.to.toISOString()),
    // 未承認（全期間）
    supabase.from('baggage_declarations').select('visits!inner(store_id)')
      .eq('tenant_id', tenant_id).in('status', ['pending', 'flagged']),
    // アンマッチ
    scoped(supabase.from('visits').select('store_id, status').eq('tenant_id', tenant_id)
      .gte('check_in_at', cur.from.toISOString()).lte('check_in_at', cur.to.toISOString()), storeScope),
    scoped(supabase.from('visits').select('store_id, status').eq('tenant_id', tenant_id)
      .gte('check_in_at', prev.from.toISOString()).lte('check_in_at', prev.to.toISOString()), storeScope),
  ])

  const visitsCurMap  = countByStore(vcCur.data  ?? [])
  const visitsPrevMap = countByStore(vcPrev.data ?? [])
  const bgCurMap  = uniqueVisitsByStore(bgCur.data  as never ?? [])
  const bgPrevMap = uniqueVisitsByStore(bgPrev.data as never ?? [])
  const pendingMap = baggageByStore(pendingAll.data as never ?? [])

  // ── ランキング生成 ─────────────────────────────────────────────────────────

  const visitsRanking: StoreRankItem[] = stores.map(s => ({
    store_id: s.id, store_name: s.name,
    value: visitsCurMap[s.id] ?? 0,
    prev_value: visitsPrevMap[s.id] ?? 0,
    delta_pct: deltaPct(visitsCurMap[s.id] ?? 0, visitsPrevMap[s.id] ?? 0),
  })).sort((a, b) => b.value - a.value)

  const inspectionRanking: StoreRankItem[] = stores.map(s => {
    const ct = visitsCurMap[s.id]  ?? 0
    const pt = visitsPrevMap[s.id] ?? 0
    const cw = bgCurMap[s.id]  ?? 0
    const pw = bgPrevMap[s.id] ?? 0
    const cv = ct > 0 ? Math.round((cw / ct) * 100) : 0
    const pv = pt > 0 ? Math.round((pw / pt) * 100) : 0
    return { store_id: s.id, store_name: s.name, value: cv, prev_value: pv, total: ct, delta_pct: cv - pv }
  }).sort((a, b) => b.value - a.value)

  const pendingRanking: StoreRankItem[] = stores.map(s => ({
    store_id: s.id, store_name: s.name,
    value: pendingMap[s.id] ?? 0, prev_value: 0,
  })).sort((a, b) => b.value - a.value)

  function unmatchRate(data: { store_id: string; status: string }[], sid: string) {
    const rows  = data.filter(v => v.store_id === sid)
    const total = rows.length
    const ac    = rows.filter(v => v.status === 'auto_closed').length
    return { total, rate: total > 0 ? Math.round((ac / total) * 100) : 0 }
  }
  const unmatchRanking: StoreRankItem[] = stores.map(s => {
    const c = unmatchRate(umCur.data  ?? [], s.id)
    const p = unmatchRate(umPrev.data ?? [], s.id)
    return { store_id: s.id, store_name: s.name, value: c.rate, prev_value: p.rate, total: c.total, delta_pct: c.rate - p.rate }
  }).sort((a, b) => b.value - a.value)

  // ── アラート生成 ───────────────────────────────────────────────────────────
  const alerts: DashboardAlert[] = []
  let ai = 0

  for (const r of inspectionRanking) {
    if ((r.delta_pct ?? 0) <= -10) {
      alerts.push({ id: `a${ai++}`, level: 'red', store_id: r.store_id, store_name: r.store_name, type: 'inspection_rate_drop',
        message: `手荷物検査実施率が前期比 ${Math.abs(r.delta_pct ?? 0)}ポイント低下（現在 ${r.value}%）`, value: r.value })
    }
  }
  for (const r of unmatchRanking) {
    if (r.value >= 15) {
      alerts.push({ id: `a${ai++}`, level: 'red', store_id: r.store_id, store_name: r.store_name, type: 'high_unmatch_rate',
        message: `退室なし率 ${r.value}%（15% 超）`, value: r.value })
    } else if (r.value >= 8) {
      alerts.push({ id: `a${ai++}`, level: 'yellow', store_id: r.store_id, store_name: r.store_name, type: 'high_unmatch_rate',
        message: `退室なし率 ${r.value}%（要注意）`, value: r.value })
    }
  }
  for (const r of pendingRanking) {
    if (r.value >= 10) {
      alerts.push({ id: `a${ai++}`, level: 'red', store_id: r.store_id, store_name: r.store_name, type: 'pending_baggage',
        message: `未審査・フラグの手荷物申告が ${r.value} 件`, value: r.value })
    } else if (r.value >= 5) {
      alerts.push({ id: `a${ai++}`, level: 'yellow', store_id: r.store_id, store_name: r.store_name, type: 'pending_baggage',
        message: `未審査・フラグの手荷物申告が ${r.value} 件`, value: r.value })
    }
  }
  if (longStayVisitors.length > 0) {
    const maxH = Math.max(...longStayVisitors.map((v: { hours: number }) => v.hours))
    alerts.push({ id: `a${ai++}`, level: maxH >= 8 ? 'red' : 'yellow', store_id: null, store_name: null, type: 'long_stay',
      message: `${longStayVisitors.length}名が 4時間以上入室中（最長 ${maxH}時間）`, value: longStayVisitors.length })
  }

  return NextResponse.json({
    today: {
      current_visitors: currentRes.count ?? 0,
      today_visits: todayRes.count ?? 0,
      pending_baggage: pendingRes.count ?? 0,
      long_stay_count: longStayVisitors.length,
      long_stay_visitors: longStayVisitors,
    },
    alerts: alerts.sort((a, b) => (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1)),
    rankings: { visits: visitsRanking, inspection_rate: inspectionRanking, pending_baggage: pendingRanking, unmatch_rate: unmatchRanking },
    period,
  } satisfies DashboardStats)
}
