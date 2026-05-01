/**
 * GET /api/v1/admin/logs
 * 監査ログ一覧（フィルター + ページネーション付き）
 *
 * Query params:
 *   logType    : 'access' | 'operation' | 'settings' | 'all' (default: 'all')
 *   userId     : admin_user_id
 *   action     : 特定の action 文字列
 *   resourceType: resource_type フィルター
 *   dateFrom   : YYYY-MM-DD
 *   dateTo     : YYYY-MM-DD
 *   search     : details の全文検索（action / resource_type / user name を ILIKE）
 *   page       : ページ番号 (default: 1)
 *   perPage    : 1ページ件数 (default: 50, max: 200)
 *   sortDir    : 'desc' | 'asc' (default: 'desc')
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

export const dynamic = 'force-dynamic'

// ── アクション種別グルーピング ────────────────────────────────────────────────
const LOG_TYPE_ACTIONS: Record<string, string[]> = {
  access:    ['login', 'logout', 'login_failed'],
  operation: ['visit_checkin', 'visit_checkout', 'visit_view', 'visit_export',
              'baggage_review', 'baggage_export',
              'prereg_create', 'prereg_delete'],
  settings:  ['settings_update',
              'user_create', 'user_update', 'user_delete',
              'store_create', 'store_update', 'store_delete', 'qr_rotate'],
}

export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const logType     = searchParams.get('logType')     || 'all'
  const userId      = searchParams.get('userId')      || ''
  const action      = searchParams.get('action')      || ''
  const resourceType = searchParams.get('resourceType') || ''
  const dateFrom    = searchParams.get('dateFrom')    || ''
  const dateTo      = searchParams.get('dateTo')      || ''
  const search      = searchParams.get('search')      || ''
  const sortDir     = searchParams.get('sortDir') === 'asc'
  const page        = Math.max(1, parseInt(searchParams.get('page') || '1'))
  const perPage     = Math.min(200, parseInt(searchParams.get('perPage') || '50'))

  const supabase = createAdminClient()

  let query = supabase
    .from('audit_logs')
    .select(
      `id, action, resource_type, resource_id, details, ip_address, user_agent, created_at,
       admin_users(id, name, email, role)`,
      { count: 'exact' }
    )
    .eq('tenant_id', ctx.tenant_id)
    .order('created_at', { ascending: sortDir })
    .range((page - 1) * perPage, page * perPage - 1)

  // ── フィルター ────────────────────────────────────────────────
  if (logType !== 'all' && LOG_TYPE_ACTIONS[logType]) {
    query = query.in('action', LOG_TYPE_ACTIONS[logType])
  }
  if (action)       query = query.eq('action', action)
  if (resourceType) query = query.eq('resource_type', resourceType)
  if (userId)       query = query.eq('admin_user_id', userId)
  if (dateFrom)     query = query.gte('created_at', dateFrom)
  if (dateTo)       query = query.lte('created_at', dateTo + 'T23:59:59')
  if (search)       query = query.or(
    `action.ilike.%${search}%,resource_type.ilike.%${search}%`
  )

  const { data, count, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 管理ユーザー一覧（フィルタードロップダウン用）
  const { data: adminUsers } = await supabase
    .from('admin_users')
    .select('id, name, email')
    .eq('tenant_id', ctx.tenant_id)
    .order('name')

  return NextResponse.json({
    logs:       data ?? [],
    total:      count ?? 0,
    adminUsers: adminUsers ?? [],
  })
}
