/**
 * POST /api/bcp/test
 *
 * テスト用 BCP アラートを発令する。指定座標から半径内の店舗すべてに対して
 * jalert-poller と同じ挿入フローを実行する（bcp_events.is_test = true）。
 *
 * Request body:
 *   lat          : number  — 震源/発令点の緯度
 *   lng          : number  — 震源/発令点の経度
 *   radiusKm     : number  — 対象半径 (km)
 *   alertType    : 'tsunami' | 'earthquake' | 'missile'
 *   alertIssuedAt: string  — ISO 8601（省略時は now()）
 *
 * Response:
 *   { eventIds: { storeId, storeName, eventId }[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

const VALID_ALERT_TYPES = ['tsunami', 'earthquake', 'missile'] as const
type AlertType = typeof VALID_ALERT_TYPES[number]

interface StoreRow {
  id: string
  name: string
  area_code: string | null
  latitude: number | null
  longitude: number | null
}

interface EdgeDevice {
  id: string
  recorders: { recorder_cameras: { id: string; name: string }[] }[]
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

async function activateStore(
  // deno-lint-ignore no-explicit-any
  supa: any,
  store: StoreRow,
  alertType: string,
  alertIssuedAt: string,
  clipFrom: string,
  clipTo: string,
): Promise<{ storeId: string; storeName: string; eventId: string }> {

  // 1. Insert bcp_events
  const { data: eventRow, error: eventErr } = await supa
    .from('bcp_events')
    .insert({
      store_id:        store.id,
      alert_source:    `test:${crypto.randomUUID()}`,
      alert_type:      alertType,
      alert_issued_at: alertIssuedAt,
      area_code:       store.area_code ?? null,
      status:          'pending',
      is_test:         true,
    })
    .select('id')
    .single()

  if (eventErr || !eventRow) throw new Error(`bcp_events insert failed: ${eventErr?.message}`)
  const eventId = eventRow.id as string

  // 2. Fetch active edge devices
  const { data: edges } = await supa
    .from('edge_devices')
    .select('id, recorders ( recorder_cameras ( id, name ) )')
    .eq('store_id', store.id)
    .neq('status', 'offline')

  const activeEdges = (edges ?? []) as unknown as EdgeDevice[]

  // 3. Insert bcp_clips
  const clipInserts = activeEdges.flatMap((edge) =>
    (edge.recorders ?? []).flatMap((rec) =>
      (rec.recorder_cameras ?? []).map((cam) => ({
        event_id:      eventId,
        camera_id:     cam.id,
        clip_from:     clipFrom,
        clip_to:       clipTo,
        upload_status: 'pending',
      }))
    )
  )

  let insertedClips: { id: string; camera_id: string }[] = []
  if (clipInserts.length > 0) {
    const { data: clipData } = await supa
      .from('bcp_clips')
      .insert(clipInserts)
      .select('id, camera_id')
    insertedClips = (clipData ?? []) as { id: string; camera_id: string }[]
  }

  const cameraToClip = new Map<string, string>(insertedClips.map((c) => [c.camera_id, c.id]))

  // 4. Advance status → recording
  await supa.from('bcp_events').update({ status: 'recording' }).eq('id', eventId)

  // 5. Write pending_command to each edge
  for (const edge of activeEdges) {
    const edgeClips = (edge.recorders ?? []).flatMap((rec) =>
      (rec.recorder_cameras ?? []).map((cam) => ({
        clipId:   cameraToClip.get(cam.id) ?? '',
        cameraId: cam.id,
      }))
    )

    await supa.from('edge_devices').update({
      pending_command: {
        action:     'start_bcp_capture',
        request_id: crypto.randomUUID(),
        eventId,
        clips:      edgeClips.map((c) => ({ clipId: c.clipId, cameraId: c.cameraId })),
        clipFrom,
        clipTo,
      },
      pending_command_at: new Date().toISOString(),
    }).eq('id', edge.id)
  }

  return { storeId: store.id, storeName: store.name, eventId }
}

export async function POST(req: NextRequest) {
  // Auth check only — use session-scoped client (RLS)
  const authSupa = await createSupabaseServer()
  const { data: { user } } = await authSupa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // All DB operations use service role to bypass RLS
  const supa = createSupabaseService()

  let body: {
    lat?: number; lng?: number; radiusKm?: number
    alertType?: string; alertIssuedAt?: string
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const { lat, lng, radiusKm = 10, alertType, alertIssuedAt: rawAt } = body

  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
  }
  if (!alertType || !VALID_ALERT_TYPES.includes(alertType as AlertType)) {
    return NextResponse.json({ error: 'alertType must be tsunami | earthquake | missile' }, { status: 400 })
  }

  const alertIssuedAt = rawAt ? new Date(rawAt).toISOString() : new Date().toISOString()

  // Fetch BCP settings defaults (we'll look up per-store below if needed)
  // For simplicity use system defaults; per-store settings can vary
  const { data: allStores } = await supa
    .from('stores')
    .select('id, name, area_code, latitude, longitude')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .limit(10_000)

  const stores = (allStores ?? []) as StoreRow[]
  const targetStores = stores.filter(
    (s) => s.latitude != null && s.longitude != null &&
      haversineKm(lat, lng, s.latitude!, s.longitude!) <= radiusKm
  )

  if (targetStores.length === 0) {
    return NextResponse.json({ error: 'no stores found within the specified radius' }, { status: 404 })
  }

  // Resolve clip window per store (use its own bcp_settings or defaults)
  const { data: allSettings } = await supa
    .from('bcp_settings')
    .select('store_id, pre_minutes, post_minutes')
    .in('store_id', targetStores.map((s) => s.id))

  const settingsMap = new Map<string, { pre: number; post: number }>(
    ((allSettings ?? []) as { store_id: string; pre_minutes: number; post_minutes: number }[])
      .map((s) => [s.store_id, { pre: s.pre_minutes, post: s.post_minutes }])
  )

  const alertTs = new Date(alertIssuedAt)

  const results = await Promise.allSettled(
    targetStores.map((store) => {
      const cfg = settingsMap.get(store.id) ?? { pre: 3, post: 5 }
      const clipFrom = new Date(alertTs.getTime() - cfg.pre  * 60_000).toISOString()
      const clipTo   = new Date(alertTs.getTime() + cfg.post * 60_000).toISOString()
      return activateStore(supa, store, alertType, alertIssuedAt, clipFrom, clipTo)
    })
  )

  const eventIds = results
    .filter((r): r is PromiseFulfilledResult<{ storeId: string; storeName: string; eventId: string }> =>
      r.status === 'fulfilled'
    )
    .map((r) => r.value)

  const failed = results.filter((r) => r.status === 'rejected').length

  console.log(`[bcp/test] ${eventIds.length} event(s) created, ${failed} failed`)

  return NextResponse.json({ eventIds, failed })
}
