/**
 * GET /api/v1/admin/stores/[id]/live-cameras
 *
 * ライブカメラ映像の HLS URL を取得する。
 * VMS の GET /api/v1/cameras/:id/live を各スロットのカメラIDで呼び出し、
 * ライブストリーム URL を返す。
 *
 * Response:
 *   {
 *     store: { id, name }
 *     vms_connected: boolean
 *     vms_url: string | null
 *     cameras: Array<{
 *       slot: 1 | 2
 *       label: string
 *       camera_id: string | null
 *       hls_url: string | null
 *       error: string | null
 *     }>
 *     fetched_at: string  (ISO 8601)
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVmsClient } from '@/lib/vms/client'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: storeId } = await params
  const admin = createAdminClient()

  // 店舗名 + 設定
  const { data: store } = await admin
    .from('stores')
    .select('id, name, settings')
    .eq('id', storeId)
    .single()

  if (!store) {
    return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 })
  }

  // カメラスロット
  const { data: slots } = await admin
    .from('store_cameras')
    .select('slot, label, vms_camera_id, ipro_camera_id, is_active')
    .eq('store_id', storeId)
    .order('slot')

  const settings = store.settings as Record<string, unknown> | null
  const vmsEnabled  = !!(settings?.vms_enabled)
  const vmsUrl      = (settings?.vms_url as string | null) ?? null
  const vmsApiKey   = (settings?.vms_api_key as string | null) ?? null

  // スロット 1, 2 を必ず返す (未登録でも空で返す)
  const slotMap = new Map(
    (slots ?? []).map(s => [s.slot as 1 | 2, s]),
  )
  const slotDefs: { slot: 1 | 2; defaultLabel: string }[] = [
    { slot: 1, defaultLabel: '受付カウンター' },
    { slot: 2, defaultLabel: '手荷物検査デスク' },
  ]

  // VMS クライアント (設定済みの場合)
  let vms: ReturnType<typeof createVmsClient> | null = null
  let vmsConnected = false
  if (vmsEnabled && vmsUrl && vmsApiKey) {
    try {
      vms = createVmsClient({ baseUrl: vmsUrl, apiKey: vmsApiKey, timeoutMs: 8000 })
      vmsConnected = true
    } catch {
      vmsConnected = false
    }
  }

  // 各スロットのライブ URL を並列で取得
  const cameras = await Promise.all(
    slotDefs.map(async ({ slot, defaultLabel }) => {
      const row = slotMap.get(slot)
      const label     = row?.label ?? defaultLabel
      const cameraId  = row?.vms_camera_id || row?.ipro_camera_id || null

      if (!vms || !cameraId) {
        return {
          slot,
          label,
          camera_id: cameraId,
          hls_url:   null,
          error: !vms
            ? 'VMS が設定されていません'
            : 'カメラID が設定されていません',
        }
      }

      try {
        const live = await vms.getLiveStream(cameraId)
        return { slot, label, camera_id: cameraId, hls_url: live.hls_url, error: null }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'ライブ取得失敗'
        return { slot, label, camera_id: cameraId, hls_url: null, error: msg }
      }
    }),
  )

  return NextResponse.json({
    store:         { id: store.id, name: store.name },
    vms_connected: vmsConnected,
    vms_url:       vmsUrl,
    cameras,
    fetched_at:    new Date().toISOString(),
  })
}
