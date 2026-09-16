/**
 * POST /api/edge/bcp-grid-complete — BCP ショット（合成/カメラ個別 共通）の決着
 *
 * Phase 2b（NVMS/docs/UPLINK_CLIPS_SPEC.md §5.2）。shot_id は
 * bcp_grid_shots（合成）か bcp_clips（カメラ個別）のどちらかの行 id。
 *
 * イベントの完了判定:
 *  - カメラ個別: bcp_clips の既存トリガ bcp_check_clips_complete が進める
 *    （Phase 2b で bcp_grid_shots の残数も見るよう拡張済み）。
 *  - 合成: トリガは bcp_clips にしか無いので、ここで**両テーブルの残数**を見て
 *    0 なら進める（1 枚でも completed → clips_uploaded、全滅 → failed。
 *    既存エッジの明示確定と同じ規則・pending/recording からのみ遷移）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'

export const dynamic = 'force-dynamic'

const Body = z.object({
  shot_id:       z.string().uuid(),
  ok:            z.boolean(),
  bytes:         z.number().int().min(0).optional(),
  dark_channels: z.array(z.number().int()).max(64).optional(),
  error:         z.string().max(500).nullable().optional(),
})

type Svc = ReturnType<typeof createSupabaseService>

async function recorderOwnedByEdge(svc: Svc, recorderId: string, edgeId: string): Promise<boolean> {
  const { data } = await svc.from('recorders').select('edge_id').eq('id', recorderId).maybeSingle()
  return !!data && data.edge_id === edgeId
}

/** 合成モードの完了判定（本文コメント参照）。 */
async function maybeFinalizeEvent(svc: Svc, eventId: string): Promise<void> {
  const { count: gridPending } = await svc
    .from('bcp_grid_shots').select('id', { count: 'exact', head: true })
    .eq('event_id', eventId).eq('upload_status', 'pending')
  if (gridPending) return
  const { count: clipPending } = await svc
    .from('bcp_clips').select('id', { count: 'exact', head: true })
    .eq('event_id', eventId).not('upload_status', 'in', '("completed","failed","skipped_ipro")')
  if (clipPending) return

  const [{ count: gridOk }, { count: clipOk }] = await Promise.all([
    svc.from('bcp_grid_shots').select('id', { count: 'exact', head: true })
      .eq('event_id', eventId).eq('upload_status', 'completed'),
    svc.from('bcp_clips').select('id', { count: 'exact', head: true })
      .eq('event_id', eventId).eq('upload_status', 'completed'),
  ])
  const anySuccess = (gridOk ?? 0) + (clipOk ?? 0) > 0
  await svc
    .from('bcp_events')
    .update({ status: anySuccess ? 'clips_uploaded' : 'failed' })
    .eq('id', eventId)
    .in('status', ['pending', 'recording'])
}

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { shot_id, ok, bytes, dark_channels, error: errMsg } = parsed.data

  const svc = createSupabaseService()

  // ① 合成ショット
  const { data: grid } = await svc
    .from('bcp_grid_shots')
    .select('id, event_id, recorder_id')
    .eq('id', shot_id)
    .maybeSingle()
  if (grid) {
    if (!(await recorderOwnedByEdge(svc, grid.recorder_id, edge.id))) {
      return NextResponse.json({ error: 'not owned by this edge' }, { status: 403 })
    }
    await svc.from('bcp_grid_shots').update({
      upload_status: ok ? 'completed' : 'failed',
      bytes:         bytes ?? null,
      dark_channels: dark_channels ?? [],
      error:         ok ? null : (errMsg ?? null),
      uploaded_at:   new Date().toISOString(),
    }).eq('id', grid.id)
    await maybeFinalizeEvent(svc, grid.event_id)
    return new NextResponse(null, { status: 204 })
  }

  // ② カメラ個別ショット（bcp_clips）
  const { data: clip } = await svc
    .from('bcp_clips')
    .select('id, camera_id, storage_path')
    .eq('id', shot_id)
    .maybeSingle()
  if (!clip) return NextResponse.json({ error: 'unknown_shot' }, { status: 404 })

  const { data: cam } = await svc
    .from('recorder_cameras').select('recorder_id').eq('id', clip.camera_id).maybeSingle()
  if (!cam || !(await recorderOwnedByEdge(svc, cam.recorder_id, edge.id))) {
    return NextResponse.json({ error: 'not owned by this edge' }, { status: 403 })
  }

  // clip_url / thumbnail_url は旧読者向け（エッジ実装 F76 と同じ扱い）。
  let publicUrl: string | null = null
  if (ok && clip.storage_path) {
    publicUrl = svc.storage.from('bcp-clips').getPublicUrl(clip.storage_path).data.publicUrl
  }
  await svc.from('bcp_clips').update({
    upload_status: ok ? 'completed' : 'failed',
    clip_url:      publicUrl,
    thumbnail_url: publicUrl,
  }).eq('id', clip.id)
  // イベントの前進は bcp_check_clips_complete トリガに任せる。

  return new NextResponse(null, { status: 204 })
}
