/**
 * Address → lat/lng via OpenStreetMap Nominatim.
 *
 * Free and unauthenticated, but rate-limited to ~1 req/sec per the OSM ToS.
 * For 10k-store bulk import, swap in Google Maps Geocoding or a paid service.
 *
 * Request:  GET /api/admin/geocode?addr=渋谷区道玄坂1-2-3
 * Response: { lat: number, lng: number, display_name: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { heavyAllows, tooManyRequests } from '@/lib/limits/heavy'

/** Nominatim の応答待ちの上限 (/api/geocode と同じ 8 秒) */
const NOMINATIM_TIMEOUT_MS = 8_000

export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const addr = req.nextUrl.searchParams.get('addr')
  if (!addr) return NextResponse.json({ error: 'addr_required' }, { status: 400 })

  // 回数の上限（利用者 60 秒 10 回・1 時間 100 回）と、Nominatim の約款（アプリ全体で 1 秒 1 回）。
  // 超えるとこちらの IP が遮断され、正規の利用者も座標を引けなくなる（自主診断 ASVS 2.4.1）
  const svc = createSupabaseService()
  const allowed = await heavyAllows(svc, 'geocode', { user: guard.user.id })
  if (!allowed.ok) return tooManyRequests(allowed.retryAfterSec)
  if (!(await heavyAllows(svc, 'nominatim', {})).ok) {
    return NextResponse.json({ error: 'geocode_busy' }, { status: 429, headers: { 'Retry-After': '1' } })
  }

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addr)}`
  let json: Array<{ lat: string; lon: string; display_name: string }>
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'RecorderMonitor/0.1 (admin geocode)' },
      signal: AbortSignal.timeout(NOMINATIM_TIMEOUT_MS),
    })
    if (!res.ok) return NextResponse.json({ error: `geocode_failed: ${res.status}` }, { status: 502 })
    json = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>
  } catch {
    // 時間切れ・接続の失敗
    return NextResponse.json({ error: 'geocode_failed: timeout' }, { status: 504 })
  }
  if (!json.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({
    lat:          parseFloat(json[0].lat),
    lng:          parseFloat(json[0].lon),
    display_name: json[0].display_name,
  })
}
