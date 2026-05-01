/**
 * GET /api/v1/admin/stores/[id]/vms-cameras
 *
 * VMS から接続中のカメラ一覧を取得する。
 * カメラ設定画面でのカメラ選択 UI に使用。
 *
 * Response:
 *   {
 *     cameras: Array<{
 *       id: string      (VMS UUID)
 *       name: string
 *       location: string
 *       status: string  ("online" | "offline" | ...)
 *       ip_address: string | null
 *     }>
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

  const { data: store } = await admin
    .from('stores')
    .select('settings')
    .eq('id', storeId)
    .single()

  const settings = store?.settings as Record<string, unknown> | null
  if (!settings?.vms_enabled || !settings.vms_url || !settings.vms_api_key) {
    return NextResponse.json({ cameras: [], error: 'VMS が設定されていません' })
  }

  try {
    const vms = createVmsClient({
      baseUrl: settings.vms_url as string,
      apiKey:  settings.vms_api_key as string,
      timeoutMs: 8000,
    })
    const cameras = await vms.getCameras()
    return NextResponse.json({
      cameras: cameras.map(c => ({
        id:         c.id,
        name:       c.name,
        location:   c.location,
        status:     c.status,
        ip_address: c.ip_address ?? null,
      })),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'カメラ一覧取得失敗'
    return NextResponse.json({ cameras: [], error: msg }, { status: 502 })
  }
}
