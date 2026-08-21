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
 *   alertType    : 'earthquake' | 'special_warning'
 *   alertIssuedAt: string  — ISO 8601（省略時は now()）
 *
 * Response:
 *   { eventIds: { storeId, storeName, eventId }[] }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { resolveMonitorScope } from '@/lib/tenant/monitor-scope'
import { haversineKm } from '@/lib/bcp/geo'

// 津波・ミサイルは 2026-08-21 に非対応（本番ポーラーが起動しない種別を
// テストからだけ撃てると、動くはずのものが動くように見えてしまう）。
const VALID_ALERT_TYPES = ['earthquake', 'special_warning'] as const

/** テスト発令を実行してよいロール（viewer / baggage_manager は不可）。 */
const TRIGGER_ROLES = ['super_admin', 'tenant_admin', 'store_manager']

/** 対象半径の上限。無制限だと 1 リクエストで全店舗を対象にできてしまう。 */
const MAX_RADIUS_KM = 500
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


async function activateStore(
  // deno-lint-ignore no-explicit-any
  supa: any,
  store: StoreRow,
  alertType: string,
  alertIssuedAt: string,
  clipFrom: string,
  clipTo: string,
  offsets: number[],
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
        // エッジは clipFrom を T+0（発令時刻）として扱う。旧VOD方式の
        // 「発令 − pre分」を渡すと全コマが pre 分過去にずれる（2026-07-13 是正）。
        clipFrom:   alertIssuedAt,
        clipTo,
        offsets,
      },
      pending_command_at: new Date().toISOString(),
    }).eq('id', edge.id)
  }

  return { storeId: store.id, storeName: store.name, eventId }
}

export async function POST(req: NextRequest) {
  const authSupa = await createSupabaseServer()
  const { data: { user } } = await authSupa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // 旧実装はログイン確認だけで、その先を service role（RLS 迂回）で回していた。
  // 対象店舗の抽出も全テナント横断（stores を無条件 select）だったため、
  // **viewer でも他テナントの店舗にテスト発令を作れた**（半径にも上限が無く、
  // radiusKm を大きくすれば 1 リクエストで全店舗が対象になった）。
  // ロールと可視店舗の両方で絞る。
  const scope = await resolveMonitorScope(authSupa)
  if (!scope.ctx.role || !TRIGGER_ROLES.includes(scope.ctx.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (scope.needsTenant) {
    // super_admin は操作中テナントを選んでから。誤って全社に撃たせない。
    return NextResponse.json({ error: 'tenant_required' }, { status: 400 })
  }
  if (scope.storeIds.length === 0) {
    return NextResponse.json({ error: 'no stores in scope' }, { status: 403 })
  }

  // 対象店舗を確定したうえで service role を使う（クリップ生成に必要なため）。
  const supa = createSupabaseService()

  let body: {
    lat?: number; lng?: number; radiusKm?: number
    alertType?: string; alertIssuedAt?: string
  }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const { lat, lng, radiusKm: rawRadius = 10, alertType, alertIssuedAt: rawAt } = body
  const radiusKm = Math.min(Math.max(rawRadius, 0), MAX_RADIUS_KM)

  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
  }
  if (!alertType || !VALID_ALERT_TYPES.includes(alertType as AlertType)) {
    return NextResponse.json({ error: 'alertType must be earthquake | special_warning' }, { status: 400 })
  }

  const alertIssuedAt = rawAt ? new Date(rawAt).toISOString() : new Date().toISOString()

  // Fetch BCP settings defaults (we'll look up per-store below if needed)
  // For simplicity use system defaults; per-store settings can vary
  const { data: allStores } = await supa
    .from('stores')
    .select('id, name, area_code, latitude, longitude')
    .in('id', scope.storeIds)   // 可視店舗の外へは絶対に出さない
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
    .select('store_id, pre_minutes, post_minutes, snapshot_offsets')
    .in('store_id', targetStores.map((s) => s.id))

  const settingsMap = new Map<string, { pre: number; post: number; offsets: number[] }>(
    ((allSettings ?? []) as { store_id: string; pre_minutes: number; post_minutes: number; snapshot_offsets: number[] | null }[])
      .map((s) => [s.store_id, { pre: s.pre_minutes, post: s.post_minutes, offsets: s.snapshot_offsets ?? [-5, 5] }])
  )

  const alertTs = new Date(alertIssuedAt)

  const results = await Promise.allSettled(
    targetStores.map((store) => {
      const cfg = settingsMap.get(store.id) ?? { pre: 3, post: 5, offsets: [-5, 5] }
      const clipFrom = new Date(alertTs.getTime() - cfg.pre  * 60_000).toISOString()
      const clipTo   = new Date(alertTs.getTime() + cfg.post * 60_000).toISOString()
      return activateStore(supa, store, alertType, alertIssuedAt, clipFrom, clipTo, cfg.offsets)
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
