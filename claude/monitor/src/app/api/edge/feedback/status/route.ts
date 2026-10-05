/**
 * GET /api/edge/feedback/status?since=<RFC3339> — 拠点が送った要望の状態と返事（GVMS_CLOUD_SPEC §12.3）
 *
 * その拠点（トークンの窓口ノード）が送った要望のうち、since より後に状態・返事・対応の版が
 * 変わったものを古い順に最大 200 件返す。続きがあれば next_since を付ける。
 * 拠点は 15 分ごとに取り、知らない status は reviewing として出す（§12.3）。
 *
 * updated_at は DB のトリガで「status / reply / fixed_version が変わったとき」だけ進む
 * （supabase/migrations/20261006090000_feedback_intake.sql）。
 *
 * since はそのまま DB の比較に渡す（JS の Date を通すとマイクロ秒が落ち、同じ行を
 * 何度も返すことになる）。読めない値は 400、無ければ最初から。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { pageStatusRows, STATUS_PAGE_LIMIT, type StatusRow } from '@/lib/feedback/status-page'

export const dynamic = 'force-dynamic'

const EPOCH = '1970-01-01T00:00:00Z'

export async function GET(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge || !edge.store_id) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const sinceParam = req.nextUrl.searchParams.get('since')
  const since = sinceParam && sinceParam.trim() ? sinceParam.trim() : EPOCH
  if (since.length > 64 || !Number.isFinite(Date.parse(since))) {
    return NextResponse.json({ error: 'invalid_since' }, { status: 400 })
  }

  const svc = createSupabaseService()
  const { data, error } = await svc
    .from('feedback_items')
    .select('local_id, id, status, reply, fixed_version, updated_at')
    .eq('edge_id', edge.id)
    .gt('updated_at', since)
    .order('updated_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(STATUS_PAGE_LIMIT + 1)
  if (error) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })

  // 返す項目は §12.3 の 6 つに限る（列を足しても拠点へ漏らさない）。
  const rows = ((data ?? []) as StatusRow[]).map((r) => ({
    local_id: r.local_id, id: r.id, status: r.status, reply: r.reply, fixed_version: r.fixed_version, updated_at: r.updated_at,
  }))
  return NextResponse.json(pageStatusRows(rows), {
    status: 200,
    headers: { 'cache-control': 'no-store' },
  })
}
