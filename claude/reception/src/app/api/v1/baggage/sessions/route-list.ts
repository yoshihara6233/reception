/**
 * 手荷物検査 履歴一覧の取得ロジック（T6）— route から呼ぶ共通実装。
 * （POST は sessions/route.ts が持つため、GET 実装をここに分離して import する）
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'
import { isFullAdmin } from '@/lib/acl'
import { filterPredicate, type HistoryFilterKey } from '@/lib/baggage/status'

export async function listSessions(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const storeId = sp.get('storeId')
  const date = sp.get('date') // YYYY-MM-DD
  const filter = (sp.get('filter') ?? 'all') as HistoryFilterKey

  const supabase = createAdminClient()
  let q = supabase
    .from('inspection_sessions')
    .select(
      'id, inspection_date, person_kind, visitor_name, employee_id, entry_at, exit_at, ' +
      'status, auth_skipped, confirmed_at, store_id, ' +
      'store_employees:employee_id ( name ), ' +
      'inspection_clips ( upload_status )',
    )
    .eq('tenant_id', ctx.tenant_id)
    .order('inspection_date', { ascending: false })
    .order('entry_at', { ascending: false })
    .limit(500)

  // 店舗スコープ（full admin 以外は担当店舗のみ）
  if (storeId) {
    if (!isFullAdmin(ctx.role) && !ctx.store_ids.includes(storeId)) {
      return NextResponse.json({ error: '権限がありません' }, { status: 403 })
    }
    q = q.eq('store_id', storeId)
  } else if (!isFullAdmin(ctx.role)) {
    q = q.in('store_id', ctx.store_ids.length ? ctx.store_ids : ['00000000-0000-0000-0000-000000000000'])
  }

  if (date) q = q.eq('inspection_date', date)

  const pred = filterPredicate(filter)
  if (pred.kind === 'status') q = q.in('status', pred.values)
  else if (pred.kind === 'auth_skipped') q = q.eq('auth_skipped', true)
  else if (pred.kind === 'unconfirmed') q = q.is('confirmed_at', null)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: 'failed to list' }, { status: 500 })

  return NextResponse.json({ sessions: data ?? [] })
}
