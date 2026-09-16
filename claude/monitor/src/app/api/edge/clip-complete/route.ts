/**
 * POST /api/edge/clip-complete — VOD クリップの決着
 *
 * Phase 2b（NVMS/docs/UPLINK_CLIPS_SPEC.md §5.4）。既存エッジが Supabase 直で
 * 行う「status='ready' + bytes + actual_from/to + ready_at」の更新を、
 * アップリンク（HTTP のみ）向けに代行する。失敗は status='failed' + error。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'

export const dynamic = 'force-dynamic'

const Body = z.object({
  clip_id: z.string().uuid(),
  ok:      z.boolean(),
  bytes:   z.number().int().min(0).optional(),
  error:   z.string().max(500).nullable().optional(),
})

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { clip_id, ok, bytes, error: errMsg } = parsed.data

  const svc = createSupabaseService()
  const { data: clip } = await svc
    .from('vod_clips')
    .select('id, edge_device_id, requested_from, requested_to')
    .eq('id', clip_id)
    .maybeSingle()
  if (!clip) return NextResponse.json({ error: 'unknown_clip' }, { status: 404 })
  if (clip.edge_device_id !== edge.id) {
    return NextResponse.json({ error: 'not owned by this edge' }, { status: 403 })
  }

  const from = new Date(clip.requested_from)
  const to   = new Date(clip.requested_to)
  const update = ok
    ? {
        status:       'ready',
        bytes:        bytes ?? null,
        // エッジ実装と同じく requested == actual とみなす（nvmsd は結合+トリム済みを返す）。
        actual_from:  from.toISOString(),
        actual_to:    to.toISOString(),
        duration_sec: Math.max(0, (to.getTime() - from.getTime()) / 1000),
        ready_at:     new Date().toISOString(),
      }
    : { status: 'failed', error: errMsg ?? 'upload failed' }

  const { error } = await svc.from('vod_clips').update(update).eq('id', clip.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
