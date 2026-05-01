/**
 * GET /api/v1/admin/stores/[id]/live-cameras
 *
 * VMS のライブストリーム URL を各カメラスロットごとに取得する。
 *
 * 解決フロー:
 *   1. store_cameras から vms_camera_id を取得
 *   2. UUID 形式でなければ VMS カメラ一覧で name/IP から UUID を解決
 *   3. GET /api/v1/cameras/:uuid/stream で HLS URL を取得
 *   4. 相対 URL は baseUrl を付与して絶対 URL に変換
 *
 * Response:
 *   {
 *     store: { id, name }
 *     vms_connected: boolean
 *     vms_url: string | null
 *     cameras: Array<{
 *       slot: 1 | 2
 *       label: string
 *       camera_id: string | null        (store に登録されている ID/名前)
 *       vms_uuid: string | null         (解決された VMS UUID)
 *       hls_url: string | null          (絶対 URL)
 *       error: string | null
 *     }>
 *     fetched_at: string
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVmsClient } from '@/lib/vms/client'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
  return await _handler(_req, params)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[live-cameras] unhandled error:', msg, err)
    return NextResponse.json({ error: `サーバーエラー: ${msg}` }, { status: 500 })
  }
}

async function _handler(
  _req: NextRequest,
  params: Promise<{ id: string }>,
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
  const vmsEnabled = !!(settings?.vms_enabled)
  const vmsUrl     = (settings?.vms_url as string | null) ?? null
  const vmsApiKey  = (settings?.vms_api_key as string | null) ?? null

  const slotMap = new Map(
    (slots ?? []).map(s => [s.slot as 1 | 2, s]),
  )
  const slotDefs: { slot: 1 | 2; defaultLabel: string }[] = [
    { slot: 1, defaultLabel: '受付カウンター' },
    { slot: 2, defaultLabel: '手荷物検査デスク' },
  ]

  // VMS クライアント
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

  // VMS カメラ一覧を先に取得 (解決 + エラー時の候補表示に使う)
  type VmsCamRow = { id: string; name: string; location: string; status: string; ip_address?: string | null }
  let vmsCameraList: VmsCamRow[] = []
  if (vms) {
    try { vmsCameraList = await vms.getCameras() } catch { /* non-fatal */ }
  }

  // 各スロットの HLS URL を並列取得
  const cameras = await Promise.all(
    slotDefs.map(async ({ slot, defaultLabel }) => {
      const row      = slotMap.get(slot)
      const label    = row?.label ?? defaultLabel
      const cameraId = row?.vms_camera_id || row?.ipro_camera_id || null

      const base = {
        slot, label, camera_id: cameraId,
        vms_uuid: null as string | null,
        hls_url:  null as string | null,
        error:    null as string | null,
      }

      if (!vms)      return { ...base, error: 'VMS が設定されていません' }
      if (!cameraId) return { ...base, error: 'カメラID が設定されていません（カメラ設定タブで選択してください）' }

      // UUID または名前/ID → VMS UUID を解決 (事前取得済みのリストを使う)
      // 保存値は UUID | name | id のいずれかの可能性がある
      let vmsUuid: string | null = null
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cameraId.trim())) {
        vmsUuid = cameraId.trim()
      } else {
        const q = cameraId.trim()
        const match = vmsCameraList.find(c =>
          c.id.trim()   === q ||
          c.name.trim() === q ||
          (c.ip_address && c.ip_address.trim() === q)
        )
        // マッチした場合: その camera の id が UUID なら UUID として使う、
        // 非 UUID (camera_01 など) ならその id をそのまま stream エンドポイントに渡す
        vmsUuid = match?.id ?? null
      }

      if (!vmsUuid) {
        const names = vmsCameraList.map(c => `${c.name}(id:${c.id})`).join('、') || '取得できませんでした'
        return {
          ...base,
          error: `カメラが見つかりません: "${cameraId}" — VMS にあるカメラ: ${names}`,
        }
      }

      try {
        const live = await vms.getLiveStream(vmsUuid)
        return { ...base, vms_uuid: vmsUuid, hls_url: live.hls_url, error: null }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'ライブ取得失敗'
        return { ...base, vms_uuid: vmsUuid, error: msg }
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
