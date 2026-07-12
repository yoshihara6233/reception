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
 * ── HLS 高速パス（2026-07-12 障害対応・必読）────────────────────────────────
 * go2rtc の HLS はセグメント 0.5 秒刻み・ライブバッファ数秒。毎リクエストで
 * Supabase 認証（getUser + RLS照会 ≒ 1〜2秒）すると、セグメント要求が届く頃には
 * バッファから追い出されて **404 → hls.js 致命エラー**（「高画質映像を表示できません」）。
 * そこで:
 *   - stream.m3u8（セッション開始点）: 従来どおりフル認証 + origin 解決。応答に
 *     HMAC 署名クッキー（camera・origin・exp を封入、TTL 10分）を発行。
 *   - api/hls/*（playlist/init/segment）: クッキー検証のみ（DB往復ゼロ・～数ms）。
 *     無効/期限切れならフル認証にフォールバック（遅いが正しく動く）。
 * hls.js は稼働中も stream.m3u8 を再取得しないため、TTL はプレイヤーの再mount
 * （モード切替・リロード・再試行）で更新される。10分を超える連続視聴では hls/* が
 * フォールバック側で継続する。
 *
 * Auth: any logged-in monitor user, and the camera must be visible to them
 * (the lookup runs under their RLS-scoped client). The go2rtc origin is taken
 * from the camera's recorder_cameras.hls_url (so multi-store/multi-tunnel works
 * without extra config). Service-token credentials come from env:
 *   GO2RTC_CF_ACCESS_CLIENT_ID / GO2RTC_CF_ACCESS_CLIENT_SECRET
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import {
  makeLiveProxyCookie,
  verifyLiveProxyCookie,
  liveProxyCookieName,
  LIVE_PROXY_COOKIE_TTL_SEC,
} from '@/lib/live-proxy-session'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ cameraId: string; path: string[] }> },
) {
  const { cameraId, path } = await ctx.params

  // 0. Path allowlist — only HLS playback paths. Prevents reaching go2rtc's
  //    control API (/api/streams, /api/config) through this proxy, which would
  //    leak other streams' RTSP credentials. hls.js needs only stream.m3u8 +
  //    the hls/ segment & media-playlist paths.
  const subPathRaw = (path ?? []).join('/')
  const isSessionStart = subPathRaw === 'api/stream.m3u8'
  const isHlsSub       = subPathRaw.startsWith('api/hls/')
  if (!isSessionStart && !isHlsSub) return new NextResponse('Forbidden path', { status: 403 })

  const signingSecret = process.env.LIVE_SIGNING_SECRET
  const cookieName    = liveProxyCookieName(cameraId)

  // 1. origin の解決。hls/* はクッキー高速パス（DB往復ゼロ）を優先し、
  //    ダメなら stream.m3u8 と同じフル認証へフォールバック。
  let origin: string | null = null
  if (isHlsSub && signingSecret) {
    origin = verifyLiveProxyCookie(req.cookies.get(cookieName)?.value, cameraId, signingSecret, Date.now())
  }

  if (!origin) {
    // フル認証: ログイン + RLS 可視性 + origin 解決。
    const supa = await createSupabaseServer()
    const { data: { user } } = await supa.auth.getUser()
    if (!user) return new NextResponse('Unauthorized', { status: 401 })

    const { data: cam } = await supa
      .from('recorder_cameras')
      .select('hls_url, recorders ( edge_devices ( go2rtc_host ) )')
      .eq('id', cameraId)
      .single()
    const row = cam as {
      hls_url: string | null
      recorders: { edge_devices: { go2rtc_host: string | null } | null } | null
    } | null
    const originSrc = row?.hls_url ?? row?.recorders?.edge_devices?.go2rtc_host
    if (!originSrc) return new NextResponse('Live not configured for this camera', { status: 404 })
    try { origin = new URL(originSrc).origin } catch { return new NextResponse('Invalid go2rtc host', { status: 500 }) }
  }

  const clientId     = process.env.GO2RTC_CF_ACCESS_CLIENT_ID
  const clientSecret = process.env.GO2RTC_CF_ACCESS_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return new NextResponse('go2rtc service token not configured', { status: 500 })
  }

  // 2. Forward GET <origin>/<path><search> with the CF Access service token.
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

  // 3. Stream back, preserving content-type. Live playlists/segments must not be
  //    cached by the browser/CDN (they change continuously).
  const res = new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type':  upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })

  // 4. セッション開始（フル認証済み）で高速パス用クッキーを発行/更新。
  //    Path をこのカメラの proxy 配下に限定（他ルートへは送られない）。
  if (isSessionStart && signingSecret) {
    res.cookies.set(cookieName, makeLiveProxyCookie(cameraId, origin, signingSecret, Date.now()), {
      path:     `/api/live-proxy/${cameraId}`,
      httpOnly: true,
      secure:   true,
      sameSite: 'lax',
      maxAge:   LIVE_PROXY_COOKIE_TTL_SEC,
    })
  }

  return res
}
