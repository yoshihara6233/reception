/**
 * POST /api/alarms/frames/ingest — 発報前後スナップ 1 枚の受信（PB7）
 *
 * エッジ（capture_alarm_timeline ハンドラ）が全カメラ×秒オフセットの録画フレームを抽出し、
 * 1 枚ずつこの API に multipart POST する。security-snapshots へ保存し alarm_frames を upsert。
 *
 * 認証: Authorization: Bearer <device_token>（edge_devices.device_token）
 * Body: multipart/form-data
 *   alarm_id   : string  (alarm_events.id)          必須
 *   camera_id  : string  (recorder_cameras.id)      必須
 *   offset_sec : string(int)  (-5|0|5|10|20|30|60|180) 必須
 *   source     : string?  (frigate-recording|ipro-nvr-recording|latest-...)
 *   image      : File     (JPEG)                     必須
 *
 * 認可: alarm_id の発報が、その device_token のエッジと同一 store のものであることを検証。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { ALARM_TIMELINE_OFFSETS_SEC, offsetKeySec } from '@/lib/alarms/timeline'
import { hashDeviceToken } from '@/lib/edge/device-token'

export const runtime = 'nodejs'

const BUCKET = 'security-snapshots'

export async function POST(req: NextRequest) {
  // 1. Edge 認証
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return NextResponse.json({ error: 'missing device token' }, { status: 401 })

  const supa = createSupabaseService()
  const { data: edge } = await supa
    .from('edge_devices')
    .select('id, store_id')
    .eq('device_token_hash', hashDeviceToken(token))
    .maybeSingle()
  if (!edge || !edge.store_id) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  // 2. multipart 解釈
  let form: FormData
  try { form = await req.formData() } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 })
  }
  const alarmId   = String(form.get('alarm_id') ?? '').trim()
  const cameraId  = String(form.get('camera_id') ?? '').trim()
  const offsetSec = Number(form.get('offset_sec'))
  const source    = String(form.get('source') ?? '').trim() || null
  const image     = form.get('image')
  if (!alarmId || !cameraId) return NextResponse.json({ error: 'alarm_id and camera_id are required' }, { status: 400 })
  if (!(ALARM_TIMELINE_OFFSETS_SEC as readonly number[]).includes(offsetSec)) {
    return NextResponse.json({ error: 'invalid offset_sec' }, { status: 400 })
  }
  if (!(image instanceof Blob)) return NextResponse.json({ error: 'image is required' }, { status: 400 })

  // 3. 認可: この発報がエッジの store のものか
  const { data: ev } = await supa
    .from('alarm_events')
    .select('id, store_id')
    .eq('id', alarmId)
    .maybeSingle()
  if (!ev || ev.store_id !== edge.store_id) {
    return NextResponse.json({ error: 'alarm not found for this edge' }, { status: 404 })
  }

  // 4. Storage 保存
  const path = `alarms/${alarmId}/frames/${cameraId}/${offsetKeySec(offsetSec)}.jpg`
  const bytes = Buffer.from(await image.arrayBuffer())
  const { error: upErr } = await supa.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  // 5. alarm_frames upsert（(alarm_event_id, camera_id, offset_sec) 一意）
  const { error: dbErr } = await supa
    .from('alarm_frames')
    .upsert({
      alarm_event_id: alarmId,
      camera_id:      cameraId,
      offset_sec:     offsetSec,
      storage_path:   path,
      status:         'completed',
      source,
      captured_at:    new Date().toISOString(),
    }, { onConflict: 'alarm_event_id,camera_id,offset_sec' })
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
