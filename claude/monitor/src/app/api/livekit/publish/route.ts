/**
 * POST /api/livekit/publish — SFU 配信のオンデマンド発停（S1）。
 *
 * Body: { cameraId, action: 'start' | 'stop' }
 *   start: room 向け Ingress(WHIP) を発行し、start_sfu をエッジへ dispatch（go2rtc H.264 を配信）。
 *   stop:  stop_stream を dispatch（エッジを idle に戻す＝配信停止）。
 *
 * 認可: LIVEKIT_ENABLED＋ログイン必須。カメラは **RLS 可視性**で検証し、そこから edge_id を解決。
 * pending_command 書込は service client（レース保護 .is('pending_command', null)）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { livekitEnabled, roomForCamera } from '@/lib/livekit'
import { createSfuIngress, buildStartSfuCommand, dispatchStartSfu, dispatchStopStream } from '@/lib/livekit-server'

export async function POST(req: NextRequest) {
  if (!livekitEnabled()) return NextResponse.json({ error: 'livekit_disabled' }, { status: 404 })

  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { cameraId?: string; action?: string } | null
  const cameraId = body?.cameraId?.trim()
  const action = body?.action
  if (!cameraId || (action !== 'start' && action !== 'stop')) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  // RLS 可視性＋edge_id 解決（見えない/未登録は 403）。camera→recorder→edge_devices。
  const { data: cam } = await supa
    .from('recorder_cameras')
    .select('recorders ( edge_id )')
    .eq('id', cameraId)
    .single()
  const edgeId = (cam as { recorders: { edge_id: string } | null } | null)?.recorders?.edge_id
  if (!edgeId) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const svc = createSupabaseService()

  if (action === 'stop') {
    await dispatchStopStream(svc, edgeId)
    return NextResponse.json({ ok: true })
  }

  // start: Ingress 発行 → start_sfu dispatch。
  const room = roomForCamera(cameraId)
  let whipUrl: string
  try {
    whipUrl = await createSfuIngress(room, edgeId)
  } catch (e) {
    return NextResponse.json({ error: 'ingress_failed', detail: (e as Error).message }, { status: 502 })
  }
  const dispatched = await dispatchStartSfu(svc, edgeId, buildStartSfuCommand(cameraId, room, whipUrl))
  // busy=true は pending_command 占有中（他コマンド処理中）。クライアントは再試行。
  return NextResponse.json({ ok: dispatched, busy: !dispatched })
}
