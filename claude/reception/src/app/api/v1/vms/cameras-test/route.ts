/**
 * POST /api/v1/vms/cameras-test
 *
 * Test VMS connection by fetching camera list.
 * Used from the camera settings page.
 *
 * Request body:
 *   { vmsUrl: string, vmsApiKey: string }
 *
 * Response:
 *   { ok: true, count: number }  |  { error: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createVmsClient } from '@/lib/vms/client'

export async function POST(req: NextRequest) {
  const { vmsUrl, vmsApiKey } = await req.json()

  if (!vmsUrl || !vmsApiKey) {
    return NextResponse.json({ error: 'vmsUrl と vmsApiKey は必須です' }, { status: 400 })
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
