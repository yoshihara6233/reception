/**
 * /api/video/sessions/[id] — 遠隔視聴のセッションの様子と停止（本人のみ）
 *
 * GET    → { kind, state, error, ready, livekit? }
 *   視聴画面は開始直後は 250 ms〜1 秒ごと（startPollDelayMs）、再生中は 10 秒ごとに呼ぶ。
 *   **これが画面の生存の合図**（viewer_seen_at）で、途切れるとクラウドは拠点へ stop_video を渡す。
 *   見始めは呼ばれる回数が多いので、viewer_seen_at は 3 秒に 1 回だけ書き直す。
 *   `ready` はプレイリストが置き場に届いたか。hls.js は 404 を取り直さないので、
 *   画面は ready になってから再生を始める（§5.2.2）。
 *   SFU（§5.4）は、**拠点が送り始める前から** ready とし、**購読専用**の視聴トークンを
 *   livekit { url, room, token } で返す（部屋はサーバが決めたもの・sfuViewerRoom）。
 *   画面は先に部屋へ入って待ち、拠点の最初のキーフレームから映す（2026-09-29 の短縮）。
 *
 * DELETE → 204。画面を閉じたときに呼ぶ。拠点へは次のポーリングで stop_video が渡る。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { requireVideoSessionAccess } from '@/lib/video/access'
import { videoKey, videoObjectExists } from '@/lib/storage/video-r2'
import { AccessToken } from 'livekit-server-sdk'
import { livekitEnabled, LIVEKIT_VIEWER_TTL_SEC } from '@/lib/livekit'
import {
  ACTIVE_STATES, sfuViewerRoom, shouldTouchViewerSeen, type VideoKind, type VideoState,
} from '@/lib/video/session-logic'

export const dynamic = 'force-dynamic'

interface Row {
  kind: VideoKind
  state: VideoState
  error: string | null
  stop_requested_at: string | null
  playlist_ready_at: string | null
  room: string | null
  viewer_seen_at: string | null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const access = await requireVideoSessionAccess(id)
  if (!access.ok) return NextResponse.json({ error: 'not_found' }, { status: access.status })

  const svc = createSupabaseService()
  const { data } = await svc
    .from('video_sessions')
    .select('kind, state, error, stop_requested_at, playlist_ready_at, room, viewer_seen_at')
    .eq('id', id)
    .maybeSingle()
  const row = data as Row | null
  if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const now = new Date()
  const nowIso = now.toISOString()
  const patch: Record<string, string> = {}
  if (ACTIVE_STATES.includes(row.state) && !row.stop_requested_at
    && shouldTouchViewerSeen(row.viewer_seen_at, now.getTime())) patch.viewer_seen_at = nowIso

  if (row.kind === 'sfu') {
    if (Object.keys(patch).length > 0) await svc.from('video_sessions').update(patch).eq('id', id)
    let livekit: { url: string; room: string; token: string } | undefined
    // 拠点が部屋へ送り始めるのを待たずに渡す（LiveKit の API も呼ばない）。部屋は視聴者の参加で
    // 先にでき、拠点の受け口（Ingress）があとから同じ部屋へ入る。映像が来ないまま長引いたときは
    // 画面側が見切る（live-remote-sfu-mode.tsx）
    const room = sfuViewerRoom(row, id)
    if (room && livekitEnabled()) {
      const at = new AccessToken(process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!,
        { identity: access.userId, ttl: LIVEKIT_VIEWER_TTL_SEC })
      at.addGrant({ roomJoin: true, room, canPublish: false, canSubscribe: true })
      livekit = { url: process.env.LIVEKIT_URL!, room, token: await at.toJwt() }
    }
    return NextResponse.json(
      { kind: row.kind, state: row.state, error: row.error, ready: !!livekit, livekit },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

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
