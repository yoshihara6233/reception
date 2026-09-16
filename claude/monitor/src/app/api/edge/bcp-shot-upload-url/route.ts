/**
 * POST /api/edge/bcp-shot-upload-url — BCP カメラ個別ショットの署名アップロード URL
 *
 * Phase 2b（NVMS/docs/UPLINK_CLIPS_SPEC.md §5.1b）。カメラ個別モードでは
 * 発令側が bcp_clips に (camera, offset) ごとの行を pending で先置きする。
 * この受け口は既存行に storage_path を確定して署名 URL を返すだけ — 行は作らない
 * （既存の完了トリガ bcp_check_clips_complete・詳細画面・PDF がそのまま効く）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { cameraShotStoragePath } from '@/lib/edge/bcp-uplink'

export const dynamic = 'force-dynamic'

const Body = z.object({
  event_id:   z.string().uuid(),
  camera_id:  z.string().uuid(),
  offset_min: z.number().int().min(-60).max(1440),
})

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { event_id, camera_id, offset_min } = parsed.data

  const svc = createSupabaseService()
  const { data: shot } = await svc
    .from('bcp_clips')
    .select('id, storage_path, clip_from')
    .eq('event_id', event_id).eq('camera_id', camera_id).eq('offset_min', offset_min)
    .maybeSingle()
  if (!shot) return NextResponse.json({ error: 'unknown_shot' }, { status: 404 })

  // 所有検査: カメラ → レコーダ → このエッジ。
  const { data: cam } = await svc
    .from('recorder_cameras').select('recorder_id').eq('id', camera_id).maybeSingle()
  const { data: rec } = cam
    ? await svc.from('recorders').select('edge_id').eq('id', cam.recorder_id).maybeSingle()
    : { data: null }
  if (!rec || rec.edge_id !== edge.id) {
    return NextResponse.json({ error: 'not owned by this edge' }, { status: 403 })
  }

  let path = shot.storage_path as string | null
  if (!path) {
    path = cameraShotStoragePath(event_id, camera_id, offset_min, new Date(shot.clip_from))
    await svc.from('bcp_clips')
      .update({ storage_path: path, upload_status: 'uploading' })
      .eq('id', shot.id)
  }

  const { data: signed, error } = await svc.storage
    .from('bcp-clips')
    .createSignedUploadUrl(path, { upsert: true })
  if (error || !signed) {
    return NextResponse.json({ error: error?.message ?? 'sign failed' }, { status: 500 })
  }

  return NextResponse.json({ url: signed.signedUrl, shot_id: shot.id })
}
