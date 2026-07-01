/**
 * POST /api/alarms/ingest — 発報受信（Phase B）
 *
 * エッジ（ONVIF Event / Frigate MQTT / i-PRO 購読）や外部 Webhook 源からの発報を受け、
 * alarm_events に記録する。スナップ画像があれば security-snapshots バケットに保存。
 *
 * 認証: Authorization: Bearer <device_token>（edge_devices.device_token）
 * Body: multipart/form-data
 *   source      : string  (onvif|frigate|ipro|webhook)  必須
 *   event_type  : string? (motion|tamper|input|...)
 *   camera_id   : string? (recorder_cameras.id)
 *   occurred_at : string? (ISO8601・省略時 now)
 *   dedup_key   : string? (同一発報の重複判定キー)
 *   image       : File?   (発報時スナップ JPEG/PNG)
 *
 * dedup: alarm_settings.dedup_window_sec 内に同一 store+dedup_key の発報があれば新規記録しない。
 * 通知（メール等）は別（PB3）。ここは「全記録」に徹する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { notifyAlarm } from '@/lib/alarms/notify'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  // 1. Edge 認証
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return NextResponse.json({ error: 'missing device token' }, { status: 401 })

  const supa = createSupabaseService()
  const { data: edge } = await supa
    .from('edge_devices')
    .select('id, store_id')
    .eq('device_token', token)
    .maybeSingle()
  if (!edge || !edge.store_id) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  // 2. multipart 解釈
  let form: FormData
  try { form = await req.formData() } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 })
  }
  const source     = String(form.get('source') ?? '').trim()
  const eventType  = String(form.get('event_type') ?? '').trim() || null
  const cameraId   = String(form.get('camera_id') ?? '').trim() || null
  const dedupKey   = String(form.get('dedup_key') ?? '').trim() || null
  const occurredAt = String(form.get('occurred_at') ?? '').trim() || new Date().toISOString()
  const image      = form.get('image')
  if (!source) return NextResponse.json({ error: 'source is required' }, { status: 400 })

  // 3. dedup（設定の window 内・同一 store+dedup_key）
  const { data: settings } = await supa
    .from('alarm_settings')
    .select('dedup_window_sec')
    .eq('store_id', edge.store_id)
    .maybeSingle()
  const dedupWindow = settings?.dedup_window_sec ?? 120
  if (dedupKey && dedupWindow > 0) {
    const since = new Date(Date.now() - dedupWindow * 1000).toISOString()
    const { data: dup } = await supa
      .from('alarm_events')
      .select('id')
      .eq('store_id', edge.store_id)
      .eq('dedup_key', dedupKey)
      .gte('occurred_at', since)
      .limit(1)
      .maybeSingle()
    if (dup) return NextResponse.json({ ok: true, deduped: true, id: dup.id })
  }

  // 4. alarm_events 起票（id を先に得る）
  const { data: ev, error: insErr } = await supa
    .from('alarm_events')
    .insert({
      store_id: edge.store_id,
      camera_id: cameraId,
      source,
      event_type: eventType,
      occurred_at: occurredAt,
      status: 'new',
      dedup_key: dedupKey,
    })
    .select('id')
    .single()
  if (insErr || !ev) return NextResponse.json({ error: insErr?.message ?? 'insert failed' }, { status: 500 })

  // 5. スナップ保存（あれば）→ snapshot_url を認証プロキシパスで記録
  let snapshotUrl: string | null = null
  if (image instanceof Blob) {
    const ext = image.type === 'image/png' ? 'png' : 'jpg'
    const path = `alarms/${ev.id}.${ext}`
    const bytes = Buffer.from(await image.arrayBuffer())
    const { error: upErr } = await supa.storage
      .from('security-snapshots')
      .upload(path, bytes, { contentType: image.type || 'image/jpeg', upsert: true })
    if (!upErr) {
      snapshotUrl = `/api/security/alarms/${ev.id}/snapshot`
      await supa.from('alarm_events').update({ snapshot_url: snapshotUrl }).eq('id', ev.id)
    }
  }

  // 6. 通知（enabled/quiet hours は notify 内で判定・best-effort）
  const notify = await notifyAlarm(supa, ev.id).catch(() => ({ notified: false, reason: 'error' }))

  return NextResponse.json({ ok: true, id: ev.id, status: 'new', snapshot_url: snapshotUrl, notified: notify.notified })
}
