/**
 * POST /api/v1/admin/stores/[id]/test-vms
 *
 * Test VMS connection using the stored API key (never sent to client).
 * Optionally accepts a new vmsApiKey in body to test before saving.
 *
 * Request body (optional):
 *   { vmsUrl?: string, vmsApiKey?: string }
 *   - If omitted, uses store's saved settings
 *
 * Response:
 *   { ok: true, count: number }  |  { error: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'
import { createVmsClient } from '@/lib/vms/client'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: storeId } = await params
  const body = await req.json().catch(() => ({}))

  const admin = createAdminClient()

  // Load stored settings
  const { data: store } = await admin
    .from('stores')
    .select('settings')
    .eq('id', storeId)
    .single()

  const settings = store?.settings as Record<string, unknown> | null

  // Use provided values, falling back to stored values
  const vmsUrl    = (body.vmsUrl    as string | undefined) || (settings?.vms_url    as string | undefined)
  const vmsApiKey = (body.vmsApiKey as string | undefined) || (settings?.vms_api_key as string | undefined)

  if (!vmsUrl || !vmsApiKey) {
    return NextResponse.json({ error: 'VMS URL または API Key が設定されていません' }, { status: 400 })
  }

  try {
    const vms = createVmsClient({ baseUrl: vmsUrl, apiKey: vmsApiKey, timeoutMs: 5000 })
    const cameras = await vms.getCameras()
    return NextResponse.json({ ok: true, count: cameras.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'VMS接続エラー'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
