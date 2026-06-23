/**
 * 接続テストジョブの作成（登録ウィザード Stage 2b）。
 * recorder の edge にジョブを積み、エッジが RTSP(ONVIF解決)から1フレーム取得して到達性確認。
 * 結果は GET /api/admin/edge-jobs/[id] でポーリング（{ok, bytes?/error?}）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'

const Body = z.object({ channel: z.coerce.number().int().min(1).max(64).optional() })

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const parsed = Body.safeParse(await req.json().catch(() => ({})))
  const channel = parsed.success ? parsed.data.channel : undefined

  const { data: rec } = await guard.supa
    .from('recorders').select('id, edge_id').eq('id', id).single()
  if (!rec) return NextResponse.json({ error: 'recorder_not_found' }, { status: 404 })

  const svc = createSupabaseService()
  const { data, error } = await svc
    .from('edge_jobs')
    .insert({ edge_id: rec.edge_id, kind: 'connection_test', params: { recorder_id: id, channel }, created_by: guard.user.id })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ job_id: data.id })
}
