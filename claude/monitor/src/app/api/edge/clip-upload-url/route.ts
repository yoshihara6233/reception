/**
 * POST /api/edge/clip-upload-url — VOD クリップの署名アップロード URL
 *
 * Phase 2b（NVMS/docs/UPLINK_CLIPS_SPEC.md §5.3）。vod_clips 行は
 * 既存の POST /api/vod が作る（start_vod コマンドの clip_id と同じ行）。
 * ここでは所有検査（vod_clips.edge_device_id）→ storage_path 確定 →
 * 署名 URL 発行のみ。ready 済みの行は再発行しない（上書き防止）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { vodStoragePath } from '@/lib/edge/bcp-uplink'

export const dynamic = 'force-dynamic'

const Body = z.object({ clip_id: z.string().uuid() })

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const svc = createSupabaseService()
  const { data: clip } = await svc
    .from('vod_clips')
    .select('id, edge_device_id, camera_id, requested_from, requested_to, status')
    .eq('id', parsed.data.clip_id)
    .maybeSingle()
  if (!clip) return NextResponse.json({ error: 'unknown_clip' }, { status: 404 })
  if (clip.edge_device_id !== edge.id) {
    return NextResponse.json({ error: 'not owned by this edge' }, { status: 403 })
  }
  if (clip.status === 'ready') {
    return NextResponse.json({ error: 'already_ready' }, { status: 409 })
  }

  const path = vodStoragePath(clip.camera_id, clip.requested_from, clip.requested_to)
  await svc.from('vod_clips')
    .update({ status: 'uploading', uploading_at: new Date().toISOString(), storage_path: path })
    .eq('id', clip.id)

  const { data: signed, error } = await svc.storage
    .from('vod-clips')
    .createSignedUploadUrl(path, { upsert: true })
  if (error || !signed) {
    return NextResponse.json({ error: error?.message ?? 'sign failed' }, { status: 500 })
  }

  return NextResponse.json({ url: signed.signedUrl })
}
