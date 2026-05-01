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
 *   { ok: true, count: number, raw_keys: string[], raw_first_camera: unknown }
 */

import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const { vmsUrl, vmsApiKey } = await req.json()

  if (!vmsUrl || !vmsApiKey) {
    return NextResponse.json({ error: 'vmsUrl と vmsApiKey は必須です' }, { status: 400 })
  }

  try {
    // raw レスポンスを直接取得してフィールド名を確認
    const res = await fetch(`${vmsUrl}/api/v1/cameras`, {
      headers: { 'Authorization': `Bearer ${vmsApiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
    })
    const raw = await res.json().catch(() => null)
    const arr = Array.isArray(raw) ? raw : (raw?.cameras ?? [])
    const first = arr[0] ?? null
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      raw_first_camera: first,
      raw_keys: first ? Object.keys(first) : [],
      count: arr.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'VMS接続エラー'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
