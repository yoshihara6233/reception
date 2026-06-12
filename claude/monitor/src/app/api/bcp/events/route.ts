/**
 * F111: DELETE /api/bcp/events — テスト発令 (is_test=true) の BCP イベントを
 * 削除する。アラート履歴の親行 (= 1 発令) に紐づく event ID 配列を受け取り、
 * 子データ → 親の順で完全削除する。
 *
 * 安全装置:
 *   - 本番アラート (is_test=false) は 1 件でも含まれていたら 403 で全拒否。
 *     テストデータ掃除専用であり、実災害の記録は誤って消せない。
 *   - requireAdmin (super_admin / tenant_admin / store_manager) のみ実行可。
 *
 * 削除順序 (bcp_clips/bcp_reports → bcp_events に FK があり CASCADE 無しのため):
 *   1. bcp_clips の storage ファイル (bcp-clips バケット) を remove
 *   2. bcp_clips 行を削除
 *   3. bcp_reports の PDF (bcp-reports バケット, <eventId>/report.pdf) を remove
 *   4. bcp_reports 行を削除
 *   5. bcp_events 行を削除
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'

const CLIPS_BUCKET   = 'bcp-clips'
const REPORTS_BUCKET = 'bcp-reports'

const Body = z.object({
  eventIds: z.array(z.string().uuid()).min(1).max(500),
})

export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error?.format() }, { status: 400 })
  }
  const { eventIds } = parsed.data

  const svc = createSupabaseService()

  // 1. 対象イベントを読み、すべて is_test=true であることを検証
  const { data: events, error: loadErr } = await svc
    .from('bcp_events')
    .select('id, is_test')
    .in('id', eventIds)
  if (loadErr) {
    return NextResponse.json({ error: 'load_failed', message: loadErr.message }, { status: 500 })
  }
  if (!events || events.length === 0) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const realEvents = events.filter((e) => e.is_test !== true)
  if (realEvents.length > 0) {
    return NextResponse.json(
      { error: 'real_alert_not_deletable', message: '本番アラートは削除できません (テスト発令のみ削除可)' },
      { status: 403 },
    )
  }
  const ids = events.map((e) => e.id as string)

  // 2. bcp_clips の storage ファイルを収集して remove
  const { data: clips } = await svc
    .from('bcp_clips')
    .select('storage_path')
    .in('event_id', ids)
  const clipPaths = (clips ?? [])
    .map((c) => (c as { storage_path: string | null }).storage_path)
    .filter((p): p is string => !!p)
  if (clipPaths.length > 0) {
    const { error: rmErr } = await svc.storage.from(CLIPS_BUCKET).remove(clipPaths)
    if (rmErr) console.warn('[bcp/events DELETE] clip storage remove warning:', rmErr.message)
  }

  // 3. bcp_clips 行を削除
  {
    const { error } = await svc.from('bcp_clips').delete().in('event_id', ids)
    if (error) return NextResponse.json({ error: 'clips_delete_failed', message: error.message }, { status: 500 })
  }

  // 4. bcp_reports の PDF を remove (<eventId>/report.pdf)
  const reportPaths = ids.map((id) => `${id}/report.pdf`)
  const { error: repRmErr } = await svc.storage.from(REPORTS_BUCKET).remove(reportPaths)
  if (repRmErr) console.warn('[bcp/events DELETE] report storage remove warning:', repRmErr.message)

  // 5. bcp_reports 行を削除
  {
    const { error } = await svc.from('bcp_reports').delete().in('event_id', ids)
    if (error) return NextResponse.json({ error: 'reports_delete_failed', message: error.message }, { status: 500 })
  }

  // 6. bcp_events 行を削除
  {
    const { error } = await svc.from('bcp_events').delete().in('id', ids)
    if (error) return NextResponse.json({ error: 'events_delete_failed', message: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, deleted: ids.length })
}
