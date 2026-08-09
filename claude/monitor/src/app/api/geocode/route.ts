/**
 * GET /api/geocode?zipcode=1600022
 *
 * 郵便番号から緯度経度を返す。
 * zipcloud から住所文字列を取得し、Nominatim (OpenStreetMap) で
 * 確実な座標を得る。zipcloud が直接座標を返す場合はそちらを優先。
 *
 * Response:
 *   { lat: number, lng: number, address: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'

interface ZipcloudResult {
  zipcode: string
  prefcode: string
  address1: string
  address2: string
  address3: string
  kana1: string
  kana2: string
  kana3: string
  latitude: string
  longitude: string
}

interface ZipcloudResponse {
  message: string | null
  results: ZipcloudResult[] | null
  status: number
}

interface NominatimResult {
  lat: string
  lon: string
  display_name: string
}

export async function GET(req: NextRequest) {
  // 呼び出し元は /bcp/test のフォームだけで、そこは認証必須のページ。
  // つまりこの受け口を無認証で開けておく理由が無い。
  //
  // 開けておくと、外部（zipcloud / Nominatim）への無料の踏み台になる。
  // 特に Nominatim は 1 req/sec の利用規約で、超過すると **こちらの UA と IP が
  // 遮断される**。そうなると店舗登録の座標取得が正規の利用者にも効かなくなる。
  // レート制限で緩和するより、ログイン必須にして経路ごと閉じるほうが確実。
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const zipcode = sp.get('zipcode')?.replace(/-/g, '') ?? ''

  if (!/^\d{7}$/.test(zipcode)) {
    return NextResponse.json({ error: '郵便番号は7桁の数字で入力してください' }, { status: 400 })
  }

  // 1. zipcloud で住所テキストを取得
  let address = ''
  let zipLat: number | null = null
  let zipLng: number | null = null

  try {
    const zipRes = await fetch(
      `https://zipcloud.ibsnet.co.jp/api/search?zipcode=${zipcode}`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (zipRes.ok) {
      const zipJson = (await zipRes.json()) as ZipcloudResponse
      const r = zipJson.results?.[0]
      if (r) {
        address = [r.address1, r.address2, r.address3].filter(Boolean).join('')
        const lat = parseFloat(r.latitude)
        const lng = parseFloat(r.longitude)
        if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
          zipLat = lat
          zipLng = lng
        }
      }
    }
  } catch {
    // zipcloud タイムアウト等は無視して Nominatim にフォールバック
  }

  // 2. zipcloud に座標があればそれを返す
  if (zipLat !== null && zipLng !== null) {
    return NextResponse.json({ lat: zipLat, lng: zipLng, address })
  }

  // 3. Nominatim で住所から座標を取得
  const query = address || `日本 〒${zipcode.slice(0, 3)}-${zipcode.slice(3)}`
  try {
    const nomRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&countrycodes=jp&format=json&limit=1`,
      {
        headers: { 'User-Agent': 'Intereco-Monitor/1.0 (geocode-api)' },
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!nomRes.ok) throw new Error(`Nominatim ${nomRes.status}`)
    const nomJson = (await nomRes.json()) as NominatimResult[]
    const hit = nomJson[0]
    if (!hit) {
      return NextResponse.json({ error: '該当する住所が見つかりませんでした' }, { status: 404 })
    }
    const lat = parseFloat(hit.lat)
    const lng = parseFloat(hit.lon)
    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json({ error: '座標の取得に失敗しました' }, { status: 500 })
    }
    return NextResponse.json({ lat, lng, address: address || hit.display_name })
  } catch (err) {
    console.error('[geocode] Nominatim error:', err)
    return NextResponse.json({ error: '座標の取得に失敗しました。しばらくしてからお試しください' }, { status: 503 })
  }
}
