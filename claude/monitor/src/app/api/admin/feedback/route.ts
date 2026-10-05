/**
 * GET /api/admin/feedback — 要望ボードの一覧と CSV の書き出し（super_admin 専用・②運営管理）
 *
 * 絞り込みは画面（/admin/feedback）と同じ検索条件（view・tenant・store・kind・status・source・topic）。
 * format=csv で CSV（UTF-8・BOM 付き）を返す。全テナント横断のため service role で読む
 * （ガードを通ってから組み立てる）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { boardCsv, loadBoardItems, parseBoardFilters } from '@/lib/feedback/board'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const sp = req.nextUrl.searchParams
  const filters = parseBoardFilters((k) => sp.get(k))
  const svc = createSupabaseService()
  const { items, error } = await loadBoardItems(svc, filters)
  if (error) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })

  if (sp.get('format') !== 'csv') {
    return NextResponse.json({ items }, { headers: { 'cache-control': 'no-store' } })
  }

  const tenantIds = [...new Set(items.map((i) => i.tenant_id))]
  const storeIds = [...new Set(items.map((i) => i.store_id).filter((v): v is string => !!v))]
  const topicIds = [...new Set(items.map((i) => i.topic_id).filter((v): v is string => !!v))]
  const [{ data: tenants }, { data: stores }, { data: topics }] = await Promise.all([
    tenantIds.length ? svc.from('tenants').select('id, name').in('id', tenantIds) : Promise.resolve({ data: [] }),
    storeIds.length ? svc.from('stores').select('id, name').in('id', storeIds) : Promise.resolve({ data: [] }),
    topicIds.length ? svc.from('feedback_topics').select('id, title').in('id', topicIds) : Promise.resolve({ data: [] }),
  ])
  const tn = new Map(((tenants ?? []) as { id: string; name: string }[]).map((t) => [t.id, t.name]))
  const st = new Map(((stores ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name]))
  const tp = new Map(((topics ?? []) as { id: string; title: string }[]).map((t) => [t.id, t.title]))

  const csv = boardCsv(items, {
    tenant: (id) => tn.get(id) ?? id,
    store: (id) => (id ? st.get(id) ?? id : ''),
    topic: (id) => (id ? tp.get(id) ?? id : ''),
  })
  const stamp = new Date().toISOString().slice(0, 10)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="feedback-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  })
}
