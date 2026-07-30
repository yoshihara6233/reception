/**
 * GET /kiosk/baggage/[storeId]/manifest.webmanifest — キオスク専用 PWA マニフェスト
 *
 * アプリ共通の manifest（start_url:/stores＝本部の管理画面）とは別に、店舗ごとに
 * start_url をそのキオスク画面へ固定する。iOS Safari「ホーム画面に追加」は
 * manifest の start_url を優先するため、これが無いと店舗 iPad でもアイコンが
 * 管理画面を開いてしまう。キオスク画面のみ generateMetadata でこれを参照する。
 */
import { createSupabaseService } from '@/lib/supabase/server'
import { manifestOrientation, normalizeOrientation } from '@/lib/baggage/kiosk-layout'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params

  // 店名はアイコン名の見栄え用途のみ（取得失敗は既定名で継続）。
  // 向きは店舗別設定。ホーム画面から起動したときに端末の据え付けと画面がずれないよう
  // manifest 側でも固定する（UI 側のレイアウト切替と対で効かせる）。
  let storeName = ''
  let orientation = normalizeOrientation(undefined)
  try {
    const svc = createSupabaseService()
    const [{ data }, { data: cfg }] = await Promise.all([
      svc.from('stores').select('name').eq('id', storeId).maybeSingle(),
      svc.from('inspection_settings').select('kiosk_orientation').eq('store_id', storeId).maybeSingle(),
    ])
    if (data?.name) storeName = String(data.name)
    orientation = normalizeOrientation(cfg?.kiosk_orientation)
  } catch {
    /* cosmetic only */
  }

  const base = `/kiosk/baggage/${storeId}`
  const manifest = {
    name: storeName ? `手荷物検査 — ${storeName}` : '手荷物検査',
    short_name: '手荷物検査',
    description: '店舗 iPad 用 手荷物検査キオスク',
    start_url: base,
    scope: base,
    display: 'standalone',
    orientation: manifestOrientation(orientation),
    background_color: '#F7F5F1',
    theme_color: '#0F0F10',
    categories: ['business', 'security'],
    icons: [
      { src: '/icons/icon-72.png',  sizes: '72x72',   type: 'image/png' },
      { src: '/icons/icon-96.png',  sizes: '96x96',   type: 'image/png' },
      { src: '/icons/icon-128.png', sizes: '128x128', type: 'image/png' },
      { src: '/icons/icon-144.png', sizes: '144x144', type: 'image/png' },
      { src: '/icons/icon-152.png', sizes: '152x152', type: 'image/png' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-384.png', sizes: '384x384', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }

  return Response.json(manifest, {
    headers: {
      'Content-Type': 'application/manifest+json',
      // 店名変更が反映されるよう短めにキャッシュ。
      'Cache-Control': 'public, max-age=300',
    },
  })
}
