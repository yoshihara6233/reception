/**
 * ONVIF 探索ジョブの作成（登録ウィザード Stage 2b）。
 * recorder の edge にジョブを積み、エッジが ONVIF からデバイス情報＋プロファイルを取得。
 * 結果は GET /api/admin/edge-jobs/[id] でポーリング。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  // 認可: その recorder が呼び出し管理者から見えるか（RLS）→ edge_id を取得。
  const { data: rec } = await guard.supa
    .from('recorders').select('id, edge_id').eq('id', id).single()
  if (!rec) return NextResponse.json({ error: 'recorder_not_found' }, { status: 404 })

  const svc = createSupabaseService()
  const { data, error } = await svc
    .from('edge_jobs')
    .insert({ edge_id: rec.edge_id, kind: 'onvif_discovery', params: { recorder_id: id }, created_by: guard.user.id })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ job_id: data.id })
}
