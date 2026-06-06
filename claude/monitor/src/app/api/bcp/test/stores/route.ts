/**
 * GET /api/bcp/test/stores?lat=&lng=&radiusKm=
 *
 * 指定座標から半径 radiusKm 以内の店舗を返す。
 * Haversine 計算は JS 側で行い、座標のある店舗だけを対象とする。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R    = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export async function GET(req: NextRequest) {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sp       = req.nextUrl.searchParams
  const lat      = parseFloat(sp.get('lat') ?? '')
  const lng      = parseFloat(sp.get('lng') ?? '')
  const radiusKm = parseFloat(sp.get('radiusKm') ?? '10')

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
  }

  const { data, error } = await supa
    .from('stores')
    .select('id, name, area_code, latitude, longitude')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .limit(10_000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const stores = (data ?? []) as {
    id: string; name: string; area_code: string | null
    latitude: number; longitude: number
  }[]

  const inRange = stores
    .map((s) => ({ ...s, distanceKm: haversineKm(lat, lng, s.latitude, s.longitude) }))
    .filter((s) => s.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)

  return NextResponse.json({ stores: inRange })
}
