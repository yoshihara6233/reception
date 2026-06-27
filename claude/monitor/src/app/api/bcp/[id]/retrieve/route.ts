/**
 * POST /api/bcp/[id]/retrieve
 *
 * 現地レコーダの録画（8枚スナップ T-5〜T+30）をオンデマンドで取得する。
 *
 * 設計:
 *   J-Alert 連動 BCP は発令時に自動取得しない（災害時の回線輻輳・アップロード負荷を避ける）。
 *   本部オペレータが BCP イベント詳細ページの「現地レコーダの録画を取得」ボタンを押すと、
 *   この経路でエッジに start_bcp_capture コマンドを発行し、現地から映像を取得する。
 *
 * 旧 jalert-poller の自動撮影ディスパッチ（bcp_clips 生成 + pending_command 書込）を
 * Next.js 側へ移設したもの。エッジの挙動は自動経路と同一。
 *
 * 取得後: edge がアップロード → status='clips_uploaded' → 自動PDF生成(bcp_report_sweep)。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'

interface EdgeRow {
  id: string
  recorders: { id: string; recorder_cameras: { id: string; name: string }[] }[]
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await ctx.params

  // 認可（super_admin / tenant_admin / store_manager）
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const svc = createSupabaseService()

  // 1. イベント取得（発令時刻・店舗・状態）
  const { data: event, error: evErr } = await svc
    .from('bcp_events')
    .select('id, store_id, alert_issued_at, status')
    .eq('id', eventId)
    .single()
  if (evErr || !event) {
    return NextResponse.json({ error: 'event_not_found' }, { status: 404 })
  }
  if (!event.store_id) {
    return NextResponse.json({ error: 'event_has_no_store' }, { status: 400 })
  }
  if (event.status === 'recording') {
    return NextResponse.json({ error: 'already_retrieving', message: '録画を取得中です。完了までお待ちください。' }, { status: 409 })
  }

  // 2. 録画ウィンドウ（発令時刻 ± pre/post 分）。設定が無ければ既定 3/5 分。
  const { data: settings } = await svc
    .from('bcp_settings')
    .select('pre_minutes, post_minutes, snapshot_offsets')
    .eq('store_id', event.store_id)
    .maybeSingle()
  const preMin  = settings?.pre_minutes  ?? 3
  const postMin = settings?.post_minutes ?? 5
  const offsets = (settings?.snapshot_offsets as number[] | null) ?? [-5, 5]
  const alertTs  = new Date(event.alert_issued_at)
  const clipFrom = new Date(alertTs.getTime() - preMin  * 60_000).toISOString()
  const clipTo   = new Date(alertTs.getTime() + postMin * 60_000).toISOString()

  // 3. 稼働中エッジ（オフライン以外）＋レコーダ＋カメラ
  const { data: edgesData, error: edgesErr } = await svc
    .from('edge_devices')
    .select('id, recorders ( id, recorder_cameras ( id, name ) )')
    .eq('store_id', event.store_id)
    .neq('status', 'offline')
  if (edgesErr) {
    return NextResponse.json({ error: 'edges_fetch_failed', message: edgesErr.message }, { status: 500 })
  }
  const edges = (edgesData ?? []) as unknown as EdgeRow[]
  if (edges.length === 0) {
    return NextResponse.json(
      { error: 'no_active_edge', message: '稼働中の現地エッジが見つかりません（オフラインの可能性）。' },
      { status: 409 },
    )
  }

  // 4. bcp_clips プレースホルダ（カメラごと1行）を挿入
  const clipInserts: { event_id: string; camera_id: string; clip_from: string; clip_to: string; upload_status: string }[] = []
  for (const edge of edges) {
    for (const rec of edge.recorders ?? []) {
      for (const cam of rec.recorder_cameras ?? []) {
        clipInserts.push({ event_id: eventId, camera_id: cam.id, clip_from: clipFrom, clip_to: clipTo, upload_status: 'pending' })
      }
    }
  }
  if (clipInserts.length === 0) {
    return NextResponse.json({ error: 'no_cameras', message: 'このエッジに登録されたカメラがありません。' }, { status: 409 })
  }

  const { data: inserted, error: clipErr } = await svc
    .from('bcp_clips')
    .insert(clipInserts)
    .select('id, camera_id')
  if (clipErr) {
    return NextResponse.json({ error: 'clip_insert_failed', message: clipErr.message }, { status: 500 })
  }
  const cameraToClip = new Map<string, string>((inserted ?? []).map((c) => [c.camera_id as string, c.id as string]))

  // 5. 各エッジへ start_bcp_capture を書込
  for (const edge of edges) {
    const clips: { clipId: string; cameraId: string }[] = []
    for (const rec of edge.recorders ?? []) {
      for (const cam of rec.recorder_cameras ?? []) {
        clips.push({ clipId: cameraToClip.get(cam.id) ?? '', cameraId: cam.id })
      }
    }
    const command = {
      action: 'start_bcp_capture',
      request_id: crypto.randomUUID(),
      eventId,
      clips,
      clipFrom,
      clipTo,
      offsets,
    }
    const { error: cmdErr } = await svc
      .from('edge_devices')
      .update({ pending_command: command, pending_command_at: new Date().toISOString() })
      .eq('id', edge.id)
    if (cmdErr) {
      return NextResponse.json({ error: 'dispatch_failed', message: cmdErr.message }, { status: 500 })
    }
  }

  // 6. status='recording'（取得中）
  await svc.from('bcp_events').update({ status: 'recording' }).eq('id', eventId)

  return NextResponse.json({ ok: true, cameras: clipInserts.length, edges: edges.length })
}
