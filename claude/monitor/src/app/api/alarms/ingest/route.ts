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
 *   camera_id   : string? (recorder_cameras.id・このエッジの店舗のカメラに限る。違えば 400)
 *   occurred_at : string? (ISO8601・省略時 now)
 *   dedup_key   : string? (同一発報の重複判定キー)
 *   image       : File?   (発報時スナップ JPEG/PNG)
 *
 * dedup: alarm_settings.dedup_window_sec 内に同一 store+dedup_key の発報があれば新規記録しない。
 * 通知（メール等）は別（PB3）。ここは「全記録」に徹する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { invalidInput } from '@/lib/api/invalid-input'
import { createSupabaseService } from '@/lib/supabase/server'
import { notifyAlarm } from '@/lib/alarms/notify'
import { dispatchAlarmTimeline } from '@/lib/alarms/dispatch'
import { isStoreOptionEnabled } from '@/lib/admin/tenant-quota'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { cameraScope } from '@/lib/alarms/camera-scope'
import { z } from 'zod'
import { sniffImage } from '@/lib/security/input'
import { dbErrorCode } from '@/lib/api/db-error'

// 項目の形と長さ (ASVS 2.2.1)。以前は自由な文字列のまま DB と通知へ流していた。
// occurred_at は過去 7 日〜未来 1 日に限る (時計の狂ったエッジが一覧の並びを壊さないように)
const Fields = z.object({
  source: z.string().trim().min(1).max(64).regex(/^[\x20-\x7E]+$/),
  event_type: z.string().trim().max(64).regex(/^[\x20-\x7E]*$/).transform((v) => v || null),
  camera_id: z.string().trim().uuid().nullable(),
  dedup_key: z.string().trim().max(200).transform((v) => v || null),
  occurred_at: z.string().datetime({ offset: true }).nullable().refine((v) => {
    if (!v) return true
    const t = Date.parse(v), now = Date.now()
    return t > now - 7 * 86_400_000 && t < now + 86_400_000
  }),
})

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  // 1. Edge 認証
  // authenticateEdge: 失敗を edge.auth_failed に記録し、止めたテナントの拠点も断る (ASVS 16.3.1・7.4.2)
  const edge = await authenticateEdge(req)
  const supa = createSupabaseService()
  if (!edge || !edge.store_id) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  // Phase2: 店舗別オプション（発報）ゲート。opt_alarm=false の店舗は発報を
  // 記録せず通知もしない（エッジが再送しないよう 200 で skipped を返す）。
  // フェイルオープン: 判別不能時は従来どおり処理を続行。
  if (!(await isStoreOptionEnabled(supa, edge.store_id, 'alarm'))) {
    return NextResponse.json({ ok: true, skipped: 'opt_alarm_off' })
  }

  // 2. multipart 解釈
  let form: FormData
  try { form = await req.formData() } catch {
    return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 })
  }
  const str = (k: string) => String(form.get(k) ?? '').trim()
  const fields = Fields.safeParse({
    source: str('source'),
    event_type: str('event_type'),
    camera_id: str('camera_id') || null,
    dedup_key: str('dedup_key'),
    occurred_at: str('occurred_at') || null,
  })
  if (!fields.success) return invalidInput(req, { error: 'invalid_fields', fields: fields.error.issues.map((i) => i.path.join('.')) })
  const { source, event_type: eventType, camera_id: cameraId, dedup_key: dedupKey } = fields.data
  const occurredAt = fields.data.occurred_at ?? new Date().toISOString()
  const image      = form.get('image')

  // カメラはこのエッジの店舗のものに限る（別の店舗・別テナントのカメラを付けた発報を作らせない）。
  // サーバの接続で書くので RLS は効かない。ここで確かめる（ASVS 2.2.3）。
  if (cameraId) {
    const scope = await cameraScope(supa, cameraId, edge.store_id)
    if (scope === 'error') return NextResponse.json({ error: 'camera_check_failed' }, { status: 503 })
    if (scope !== 'ok') return NextResponse.json({ error: 'camera_not_in_store' }, { status: 400 })
  }

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
  if (insErr || !ev) return NextResponse.json({ error: dbErrorCode(insErr, '/api/alarms/ingest') }, { status: 500 })

  // 5. スナップ保存（あれば）→ snapshot_url を認証プロキシパスで記録
  let snapshotUrl: string | null = null
  // 形式は送り手の申告ではなく中身の先頭の印で決める。JPEG と PNG 以外は保存しない (ASVS 5.2.2)
  const bytes = image instanceof Blob ? Buffer.from(await image.arrayBuffer()) : null
  const kind = bytes ? sniffImage(bytes) : null
  if (bytes && (kind === 'image/jpeg' || kind === 'image/png')) {
    const path = `alarms/${ev.id}.${kind === 'image/png' ? 'png' : 'jpg'}`
    const { error: upErr } = await supa.storage
      .from('security-snapshots')
      .upload(path, bytes, { contentType: kind, upsert: true, cacheControl: '0' })
    if (!upErr) {
      snapshotUrl = `/api/security/alarms/${ev.id}/snapshot`
      await supa.from('alarm_events').update({ snapshot_url: snapshotUrl }).eq('id', ev.id)
    }
  }

  // 6. 発報前後スナップ（PB7）: 店舗全カメラ×秒オフセットの取得をエッジへ依頼。
  //    pending_command（巡回/BCP と共有の単一スロット）が空いている時だけ投入され、
  //    埋まっていた場合は timeline_dispatched_at が NULL のまま残り
  //    /api/cron/alarm-dispatch-retry が直近分を再送する（是正3）。即時スナップは記録済み。
  await dispatchAlarmTimeline(supa, edge.id, ev.id, occurredAt)

  // 7. 通知（enabled/quiet hours は notify 内で判定・best-effort）
  const notify = await notifyAlarm(supa, ev.id).catch(() => ({ notified: false, reason: 'error' }))

  return NextResponse.json({ ok: true, id: ev.id, status: 'new', snapshot_url: snapshotUrl, notified: notify.notified })
}
