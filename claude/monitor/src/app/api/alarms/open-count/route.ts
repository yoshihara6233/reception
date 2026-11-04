/**
 * GET /api/alarms/open-count — 未完了（未対応/対応中）発報の件数
 *
 * 上段メニューの ALARM を赤字化するために、ヘッダが軽量ポーリングで取得する。
 * RLS 越し（セッション）なので、閲覧可能な店舗の発報のみ数える。
 *
 * **数える範囲は発報タイムライン (/alarms) と同じにする** (2026-11-04・シナリオ試験の所見)。
 * 以前は RLS だけに任せていて、全体管理者は操作中でない他のテナントの発報まで数えていた
 * (ALARM に (1) と出るのに、開くとタイムラインは 0 件)。resolveMonitorScope の店舗に絞り、
 * テナント未選択 (タイムラインはテナントの選択を求める) は 0 件とする。
 */
import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { resolveMonitorScope } from '@/lib/tenant/monitor-scope'

export const runtime = 'nodejs'

const zero = () => NextResponse.json({ count: 0 }, { headers: { 'Cache-Control': 'no-store' } })

export async function GET() {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return zero()

  const scope = await resolveMonitorScope(supa)
  if (scope.needsTenant || scope.storeIds.length === 0) return zero()

  const { count } = await supa
    .from('alarm_events')
    .select('id', { count: 'exact', head: true })
    .in('store_id', scope.storeIds)
    .neq('status', 'closed')
    // 一覧に出さない G・VMS の機械の状態 (source='nvms') は数えない
    .neq('source', 'nvms')

  return NextResponse.json({ count: count ?? 0 }, { headers: { 'Cache-Control': 'no-store' } })
}
