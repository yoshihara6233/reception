/**
 * /api/video/sessions/[id] — 遠隔視聴のセッションの様子と停止（本人のみ）
 *
 * GET    → { kind, state, error, ready }
 *   視聴画面は開始直後は 1 秒ごと、再生中は 10 秒ごとに呼ぶ。**これが画面の生存の合図**
 *   （viewer_seen_at）で、途切れるとクラウドは拠点へ stop_video を渡す。
 *   `ready` はプレイリストが置き場に届いたか。hls.js は 404 を取り直さないので、
 *   画面は ready になってから再生を始める（§5.2.2）。
 *
 * DELETE → 204。画面を閉じたときに呼ぶ。拠点へは次のポーリングで stop_video が渡る。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { requireVideoSessionAccess } from '@/lib/video/access'
import { videoKey, videoObjectExists } from '@/lib/storage/video-r2'
import { ACTIVE_STATES, type VideoKind, type VideoState } from '@/lib/video/session-logic'

export const dynamic = 'force-dynamic'

interface Row {
  kind: VideoKind
  state: VideoState
  error: string | null
  stop_requested_at: string | null
  playlist_ready_at: string | null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireVideoSessionAccess(id)
  if (!access.ok) return NextResponse.json({ error: 'not_found' }, { status: access.status })

  const svc = createSupabaseService()
  const { data } = await svc
    .from('video_sessions')
    .select('kind, state, error, stop_requested_at, playlist_ready_at')
    .eq('id', id)
    .maybeSingle()
  const row = data as Row | null
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const nowIso = new Date().toISOString()
  const patch: Record<string, string> = {}
  if (ACTIVE_STATES.includes(row.state) && !row.stop_requested_at) patch.viewer_seen_at = nowIso

  let ready = !!row.playlist_ready_at
  if (!ready && (row.state === 'dispatched' || row.state === 'started' || row.state === 'ended')) {
    ready = await videoObjectExists(videoKey(id, 'playlist')).catch(() => false)
    if (ready) patch.playlist_ready_at = nowIso
  }
  if (Object.keys(patch).length > 0) await svc.from('video_sessions').update(patch).eq('id', id)

  return NextResponse.json(
    { kind: row.kind, state: row.state, error: row.error, ready },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireVideoSessionAccess(id)
  if (!access.ok) return NextResponse.json({ error: 'not_found' }, { status: access.status })

  await createSupabaseService()
    .from('video_sessions')
    .update({ stop_requested_at: new Date().toISOString() })
    .eq('id', id)
    .in('state', ACTIVE_STATES as string[])
    .is('stop_requested_at', null)
  return new NextResponse(null, { status: 204 })
}
