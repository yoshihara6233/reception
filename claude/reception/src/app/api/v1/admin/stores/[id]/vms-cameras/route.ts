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
 *     raw_first_camera?: unknown   (debug: フィールド名確認用)
 *     raw_keys?: string[]
 *   }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

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

  const vmsUrl    = settings.vms_url as string
  const vmsApiKey = settings.vms_api_key as string

  try {
    // raw レスポンスを直接取得してフィールド名を確認
    const res = await fetch(`${vmsUrl}/api/v1/cameras`, {
      headers: {
        'Authorization': `Bearer ${vmsApiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json({ cameras: [], error: `VMS ${res.status}: ${text.slice(0, 200)}` }, { status: 502 })
    }

    const raw = await res.json()
    const arr: unknown[] = Array.isArray(raw) ? raw : (raw?.cameras ?? [])
    const first = arr[0] ?? null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cameras = arr.map((c: any) => ({
      id:         c.id ?? c.camera_id ?? c.uuid ?? c._id ?? null,
      name:       c.name ?? c.camera_name ?? null,
      location:   c.location ?? c.area ?? '',
      status:     c.status ?? 'unknown',
      ip_address: c.ip_address ?? c.ip ?? null,
    }))

    return NextResponse.json({
      cameras,
      raw_first_camera: first,
      raw_keys: first && typeof first === 'object' ? Object.keys(first as object) : [],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'カメラ一覧取得失敗'
    return NextResponse.json({ cameras: [], error: msg }, { status: 502 })
  }
}
