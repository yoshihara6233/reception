/**
 * F77 / Phase 8.4-B — VOD clip status polling.
 *
 * GET /api/vod/<clipId>/status
 *
 * The browser polls this every ~1 s after POST /api/vod returns. When the
 * row flips to `ready`, the player swaps from "uploading..." overlay to a
 * <video src="/api/vod/<clipId>"> element.
 *
 * Returns a tiny payload to keep polling cheap.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  ctx:  { params: Promise<{ clipId: string }> },
): Promise<NextResponse> {
  const { clipId } = await ctx.params

  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: row, error } = await supa
    .from('vod_clips')
    .select('id, status, error, duration_sec, actual_from, actual_to, bytes, ready_at')
    .eq('id', clipId)
    .single()

  if (error || !row) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  return NextResponse.json({
    clip_id:      row.id,
    status:       row.status,
    error:        row.error,
    duration_sec: row.duration_sec,
    actual_from:  row.actual_from,
    actual_to:    row.actual_to,
    bytes:        row.bytes,
    ready_at:     row.ready_at,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
