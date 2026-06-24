/**
 * Frigate 録画 HLS リバースプロキシ（VOD as native HLS）。
 *
 * Frigate(nginx-vod) は録画を
 *   /vod/<YYYY-MM>/<DD>/<HH>/<camera>/UTC/master.m3u8
 * で fMP4 HLS 配信する（H.264・シーク可・再エンコード不要）。Frigate は Cloudflare
 * Access 配下なので、live-proxy と同じ思想で「monitor セッションで認証 → サーバ側で
 * CF Access Service Token を付けて取得」する。ブラウザは Cloudflare Access に触れない。
 *
 * 従来の clip.mp4 取得＋edge再エンコード＋Storageアップロード経路（重く90秒上限あり）の
 * 代替。Frigate は録画が元々ファイルなので RTSP replay は不可だが、HLS はネイティブ対応。
 *
 * パス保持: ブラウザは
 *   /api/vod-hls/<cameraId>/vod/2026-06/24/13/<cam>/UTC/master.m3u8
 * を要求し、master.m3u8 内の相対 index.m3u8 / *.m4s も同プレフィクスで解決する。
 * upstream は recorders.live_host（Frigate origin）。`vod/` 配下のみ許可。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ cameraId: string; path: string[] }> },
) {
  const { cameraId, path } = await ctx.params
  const subPathRaw = (path ?? []).join('/')

  // 0. パス許可リスト — 録画HLS(/vod/配下)のみ。Frigate の制御API等への到達を防ぐ。
  if (!subPathRaw.startsWith('vod/')) {
    return new NextResponse('Forbidden path', { status: 403 })
  }

  // 1. 認証 — monitor ログインユーザのみ。
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  // 2. Frigate origin を解決（RLSスコープ＝越権カメラは null→404）。frigate のみ対応。
  const { data: cam } = await supa
    .from('recorder_cameras')
    .select('recorders ( live_host, vendor )')
    .eq('id', cameraId)
    .single()
  const row = cam as { recorders: { live_host: string | null; vendor: string } | null } | null
  if (row?.recorders?.vendor !== 'frigate') {
    return new NextResponse('VOD-HLS is supported for frigate recorders only', { status: 404 })
  }
  const originSrc = row.recorders.live_host
  if (!originSrc) return new NextResponse('VOD not configured for this camera', { status: 404 })

  let origin: string
  try { origin = new URL(originSrc).origin } catch { return new NextResponse('Invalid frigate host', { status: 500 }) }

  const clientId     = process.env.GO2RTC_CF_ACCESS_CLIENT_ID
  const clientSecret = process.env.GO2RTC_CF_ACCESS_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return new NextResponse('frigate service token not configured', { status: 500 })
  }

  // 3. <origin>/<path><search> を CF Access Service Token 付きで取得。secure_token の
  //    クエリも保持するため req.nextUrl.search を付与する。
  const target = `${origin}/${subPathRaw}${req.nextUrl.search}`

  let upstream: Response
  try {
    upstream = await fetch(target, {
      headers: {
        'CF-Access-Client-Id':     clientId,
        'CF-Access-Client-Secret': clientSecret,
      },
      cache: 'no-store',
    })
  } catch {
    return new NextResponse('Upstream fetch failed', { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    return new NextResponse(null, { status: upstream.status === 404 ? 404 : 502 })
  }

  // 4. content-type を保ってストリーム返却。録画HLSはキャッシュさせない。
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type':  upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}
