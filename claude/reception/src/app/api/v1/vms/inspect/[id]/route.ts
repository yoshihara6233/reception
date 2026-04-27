/**
 * PATCH /api/v1/vms/inspect/[id]
 *
 * 検査終了: VMS に ended_at を送り、baggage_declarations に inspection_ended_at を保存する。
 *
 * Request body:
 *   { declarationId: string, storeId: string, endedAt?: string }
 *
 * GET /api/v1/vms/inspect/[id]
 *
 * 検査情報再取得: VMS から最新の hls_url と status を返す。
 *
 * Request query:
 *   ?storeId=<storeId>
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVmsClient } from '@/lib/vms/client'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: inspectionId } = await params
  const { declarationId, storeId, endedAt } = await req.json()

  if (!storeId) {
    return NextResponse.json({ error: 'storeId は必須です' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: store } = await admin
    .from('stores')
    .select('settings')
    .eq('id', storeId)
    .single()

  const settings = store?.settings as {
    vms_url?: string; vms_api_key?: string; vms_enabled?: boolean
  } | null

  if (!settings?.vms_enabled || !settings.vms_url || !settings.vms_api_key) {
    return NextResponse.json({ error: 'VMS未設定' }, { status: 400 })
  }

  const vms = createVmsClient({ baseUrl: settings.vms_url, apiKey: settings.vms_api_key })

  try {
    const inspection = await vms.endInspection(inspectionId, endedAt)

    // Update declaration if declarationId provided
    if (declarationId) {
      await admin
        .from('baggage_declarations')
        .update({ inspection_ended_at: inspection.ended_at ?? new Date().toISOString() })
        .eq('id', declarationId)
    }

    return NextResponse.json({ success: true, inspection })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'VMS接続エラー'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: inspectionId } = await params
  const storeId = new URL(req.url).searchParams.get('storeId')

  if (!storeId) {
    return NextResponse.json({ error: 'storeId は必須です' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: store } = await admin
    .from('stores')
    .select('settings')
    .eq('id', storeId)
    .single()

  const settings = store?.settings as {
    vms_url?: string; vms_api_key?: string; vms_enabled?: boolean
  } | null

  if (!settings?.vms_enabled || !settings.vms_url || !settings.vms_api_key) {
    return NextResponse.json({ error: 'VMS未設定' }, { status: 400 })
  }

  const vms = createVmsClient({ baseUrl: settings.vms_url, apiKey: settings.vms_api_key })

  try {
    const inspection = await vms.getInspection(inspectionId)
    return NextResponse.json(inspection)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'VMS接続エラー'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
