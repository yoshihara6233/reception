/**
 * エッジがクリップ切り出しジョブを取得する（T5・poll）
 *
 * GET /api/v1/baggage/edge/clip-jobs
 *   ヘッダ: x-edge-token / x-edge-api-version
 *   自店舗の pending かつ not_before 経過済みジョブを running に claim して返す。
 *   （単一エッジ/店舗前提。stale な running は日次sweeperで戻す＝T7）
 *
 * res: { jobs: [{ id, session_id, window_from, window_to, deadline_at,
 *                 camera: { id, ipro_camera_id, ipro_recorder_id, slot, label } | null }] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateEdge } from '@/lib/edge/auth'

export async function GET(req: NextRequest) {
  const auth = await authenticateEdge(req.headers)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status })

  const supabase = createAdminClient()
  const nowIso = new Date().toISOString()

  // pending かつ not_before 経過済みを running に claim（返却と同時に確保）
  const { data, error } = await supabase
    .from('inspection_clip_jobs')
    .update({ status: 'running', updated_at: nowIso })
    .eq('store_id', auth.storeId)
    .eq('status', 'pending')
    .lte('not_before', nowIso)
    .select(
      'id, session_id, window_from, window_to, deadline_at, ' +
      'camera:camera_id ( id, ipro_camera_id, ipro_recorder_id, slot, label )',
    )

  if (error) {
    return NextResponse.json({ error: 'failed to fetch jobs' }, { status: 500 })
  }

  return NextResponse.json({ jobs: data ?? [] })
}
