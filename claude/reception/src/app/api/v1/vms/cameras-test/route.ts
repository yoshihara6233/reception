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
import { getAdminContext } from '@/lib/supabase/admin-context'

// SSRF safe-list: only allow fetching from URLs that pass the same check as webhooks
function isAllowedVmsUrl(rawUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  // Block cloud metadata endpoints
  if (host === '169.254.169.254' || host === 'metadata.google.internal') return false
  // VMS servers are typically on-premise (private IPs are OK here, localhost is not)
  if (host === 'localhost') return false
  return true
}

export async function POST(req: NextRequest) {
  // Require admin auth — this endpoint makes server-side requests to arbitrary URLs
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { vmsUrl, vmsApiKey } = await req.json()

  if (!vmsUrl || !vmsApiKey) {
    return NextResponse.json({ error: 'vmsUrl と vmsApiKey は必須です' }, { status: 400 })
  }

  // SSRF guard: block metadata endpoints (VMS may be on private network, that is acceptable)
  if (!isAllowedVmsUrl(vmsUrl)) {
    return NextResponse.json({ error: '不正なVMS URLです' }, { status: 400 })
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
