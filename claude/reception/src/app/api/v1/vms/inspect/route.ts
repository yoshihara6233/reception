/**
 * POST /api/v1/vms/inspect
 *
 * Server-side proxy to the on-premise VMS API.
 * Keeps the VMS API key out of the browser.
 *
 * Request body:
 *   { storeId: string, cameraId: string, visitId?: string }
 *
 * Response:
 *   { inspection_id: string, hls_url: string }
 *   or { error: string, skipped?: true }  ← when VMS not configured (soft failure)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVmsClient } from '@/lib/vms/client'

export async function POST(req: NextRequest) {
  try {
    const { storeId, cameraId, visitId } = await req.json()

    if (!storeId || !cameraId) {
      return NextResponse.json({ error: 'storeId と cameraId は必須です' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Fetch store VMS settings
    const { data: store, error: storeErr } = await supabase
      .from('stores')
      .select('settings')
      .eq('id', storeId)
      .single()

    if (storeErr || !store) {
      return NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 })
    }

    const settings = store.settings as {
      vms_url?: string
      vms_api_key?: string
      vms_enabled?: boolean
    } | null

    if (!settings?.vms_enabled || !settings.vms_url || !settings.vms_api_key) {
      // VMS not configured — soft failure, caller can proceed without video
      return NextResponse.json({ skipped: true, error: 'VMS未設定' }, { status: 200 })
    }

    const vms = createVmsClient({
      baseUrl: settings.vms_url,
      apiKey: settings.vms_api_key,
    })

    const inspection = await vms.createInspection({
      camera:     cameraId,
      startedAt:  new Date().toISOString(),
      subjectRef: visitId,
    })

    return NextResponse.json({
      inspection_id: inspection.id,
      hls_url: inspection.hls_url,
    })
  } catch (err) {
    console.error('[vms/inspect] error:', err)
    const msg = err instanceof Error ? err.message : 'VMS接続エラー'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
