/**
 * edge_jobs の状態取得（ウィザードのポーリング用）。
 * status / result / error を返す。認可はジョブの edge が呼び出し管理者から見えるか。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const svc = createSupabaseService()
  const { data: job, error } = await svc
    .from('edge_jobs')
    .select('id, edge_id, kind, status, result, error, created_at')
    .eq('id', id)
    .single()
  if (error || !job) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // 認可: ジョブの edge が見えるか（RLS セッション）。
  const { data: edge } = await guard.supa
    .from('edge_devices').select('id').eq('id', job.edge_id).single()
  if (!edge) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  return NextResponse.json({
    id: job.id, kind: job.kind, status: job.status, result: job.result, error: job.error,
  })
}
