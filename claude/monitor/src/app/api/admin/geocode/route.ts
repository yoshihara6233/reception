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

export async function GET(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const addr = req.nextUrl.searchParams.get('addr')
  if (!addr) return NextResponse.json({ error: 'addr_required' }, { status: 400 })

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addr)}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'RecorderMonitor/0.1 (admin geocode)' },
  })
  if (!res.ok) return NextResponse.json({ error: `geocode_failed: ${res.status}` }, { status: 502 })

  const json = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>
  if (!json.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  return NextResponse.json({
    lat:          parseFloat(json[0].lat),
    lng:          parseFloat(json[0].lon),
    display_name: json[0].display_name,
  })
}
