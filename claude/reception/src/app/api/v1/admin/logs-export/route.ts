/**
 * GET /api/v1/admin/logs-export
 * 監査ログを CSV でエクスポート（最大 10,000 件）
 * 受け付けるクエリパラメータは /api/v1/admin/logs と同じ
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'

export const dynamic = 'force-dynamic'

const LOG_TYPE_ACTIONS: Record<string, string[]> = {
  access:    ['login', 'logout', 'login_failed'],
  operation: ['visit_checkin', 'visit_checkout', 'visit_view', 'visit_export',
              'baggage_review', 'baggage_export',
              'prereg_create', 'prereg_delete'],
  settings:  ['settings_update',
              'user_create', 'user_update', 'user_delete',
              'store_create', 'store_update', 'store_delete', 'qr_rotate'],
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export async function GET(req: NextRequest) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const logType      = searchParams.get('logType')      || 'all'
  const userId       = searchParams.get('userId')       || ''
  const action       = searchParams.get('action')       || ''
  const resourceType = searchParams.get('resourceType') || ''
  const dateFrom     = searchParams.get('dateFrom')     || ''
  const dateTo       = searchParams.get('dateTo')       || ''
  const search       = searchParams.get('search')       || ''

  const supabase = createAdminClient()

  let query = supabase
    .from('audit_logs')
    .select(`id, action, resource_type, resource_id, details, ip_address, user_agent, created_at,
             admin_users(name, email)`)
    .eq('tenant_id', ctx.tenant_id)
    .order('created_at', { ascending: false })
    .limit(10000)

  if (logType !== 'all' && LOG_TYPE_ACTIONS[logType]) {
    query = query.in('action', LOG_TYPE_ACTIONS[logType])
  }
  if (action)        query = query.eq('action', action)
  if (resourceType)  query = query.eq('resource_type', resourceType)
  if (userId)        query = query.eq('admin_user_id', userId)
  if (dateFrom)      query = query.gte('created_at', dateFrom)
  if (dateTo)        query = query.lte('created_at', dateTo + 'T23:59:59')
  if (search)        query = query.or(`action.ilike.%${search}%,resource_type.ilike.%${search}%`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const header = ['日時', 'ユーザー名', 'メール', 'アクション', 'リソース種別', 'リソースID', 'IPアドレス', 'UserAgent', '詳細']
  const rows = (data ?? []).map((row: Record<string, unknown>) => {
    const user = row.admin_users as { name?: string; email?: string } | null
    return [
      new Date(row.created_at as string).toLocaleString('ja-JP'),
      user?.name ?? '',
      user?.email ?? '',
      row.action,
      row.resource_type,
      row.resource_id ?? '',
      row.ip_address ?? '',
      row.user_agent ?? '',
      JSON.stringify(row.details ?? {}),
    ].map(csvEscape).join(',')
  })

  const bom = '\uFEFF'
  const csv = bom + [header.join(','), ...rows].join('\n')
  const filename = `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`

  return new NextResponse(csv, {
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
