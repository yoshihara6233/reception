/**
 * go2rtc HLS reverse-proxy (Phase 4 — remove per-user Cloudflare login).
 *
 * The edge's go2rtc transcodes H.265→H.264 and serves HLS, but it sits behind
 * Cloudflare Access. Rather than make every operator authenticate to the camera
 * domain (a second login on top of the monitor login), the monitor proxies the
 * HLS here: the end user is authenticated by their monitor (Supabase) session,
 * and this server-side route attaches a Cloudflare Access **Service Token** to
 * reach go2rtc. The browser never touches Cloudflare Access, and go2rtc's API is
 * never exposed directly to end users.
 *
 * Path-preserving: the browser requests
 *   /api/live-proxy/<cameraId>/api/stream.m3u8?src=cam101_h264
 * and go2rtc's relative playlist/segment URLs (hls/playlist.m3u8?id=…, segments)
 * resolve back through this same prefix automatically — no playlist rewriting.
 *
 * Auth: any logged-in monitor user, and the camera must be visible to them
 * (the lookup runs under their RLS-scoped client). The go2rtc origin is taken
 * from the camera's recorder_cameras.hls_url (so multi-store/multi-tunnel works
 * without extra config). Service-token credentials come from env:
 *   GO2RTC_CF_ACCESS_CLIENT_ID / GO2RTC_CF_ACCESS_CLIENT_SECRET
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ cameraId: string; path: string[] }> },
) {
  const { cameraId, path } = await ctx.params

  // 1. Auth — must be a logged-in monitor user.
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  // 2. Resolve the go2rtc origin from the camera's hls_url. The lookup is
  //    RLS-scoped to the user, so an out-of-tenant camera returns null → 404.
  const { data: cam } = await supa
    .from('recorder_cameras')
    .select('hls_url')
    .eq('id', cameraId)
    .single()
  const hlsUrl = (cam as { hls_url: string | null } | null)?.hls_url
  if (!hlsUrl) return new NextResponse('Live not configured for this camera', { status: 404 })

  let origin: string
  try { origin = new URL(hlsUrl).origin } catch { return new NextResponse('Invalid hls_url', { status: 500 }) }

  const clientId     = process.env.GO2RTC_CF_ACCESS_CLIENT_ID
  const clientSecret = process.env.GO2RTC_CF_ACCESS_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return new NextResponse('go2rtc service token not configured', { status: 500 })
  }

  // 3. Forward GET <origin>/<path><search> with the CF Access service token.
  const subPath = (path ?? []).join('/')
  const target  = `${origin}/${subPath}${req.nextUrl.search}`

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

  // 4. Stream back, preserving content-type. Live playlists/segments must not be
  //    cached by the browser/CDN (they change continuously).
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type':  upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}
