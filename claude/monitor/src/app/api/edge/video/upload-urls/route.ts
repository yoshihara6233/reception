/**
 * POST /api/edge/video/upload-urls — HLS の送り先の取り直し（GVMS_CLOUD_SPEC §5.2.3）
 *
 *   { session_id } → 200 { slots, init, playlist, expires_at }
 *                  → 404 セッションが終わっている（拠点はそのセッションを止める）
 *
 * **応答の URL には署名が入る。ログに出さない**（ここでも console に本文を書かない）。
 * 取り直せるのはこの拠点の、動いている HLS のセッションだけ。止めたいセッション
 * （画面が閉じた・生存切れ）にも 404 を返し、送り続けさせない。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { presignVideoUpload, videoR2Configured } from '@/lib/storage/video-r2'
import { wantsStop, type DispatchRow } from '@/lib/video/session-logic'

export const dynamic = 'force-dynamic'

const Body = z.object({ session_id: z.string().uuid() })

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const { data } = await createSupabaseService()
    .from('video_sessions')
    .select('id, kind, state, viewer_seen_at, stop_requested_at, refresh_sent_at, dispatched_at')
    .eq('id', parsed.data.session_id)
    .eq('edge_id', edge.id)
    .maybeSingle()
  const row = data as DispatchRow | null
  if (
    !row
    || (row.state !== 'dispatched' && row.state !== 'started')
    || (row.kind !== 'hls_live' && row.kind !== 'hls_vod')
    || wantsStop(row, Date.now())
  ) {
    return NextResponse.json({ error: 'session_not_found' }, { status: 404 })
  }
  if (!videoR2Configured()) return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 })

  const upload = await presignVideoUpload(row.id, row.kind)
  return NextResponse.json(upload, { headers: { 'Cache-Control': 'no-store' } })
}
