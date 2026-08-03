/**
 * Proxy the latest per-camera snapshot JPEG.
 *
 * Edge mode 'live' uploads `edges/<edgeId>/cam/<cameraId>/snapshot.jpg` to
 * Supabase Storage every ~1s. This route just streams that object back to
 * the browser with no-cache headers so the polling <img> always gets the
 * freshest available frame. Mirrors the existing per-edge grid route.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import {
  edgeImagesR2Configured, edgeImageExists, presignEdgeImageGet, snapshotKey,
} from '@/lib/storage/edge-images-r2'
import {
  edgeImagesWorkerConfigured, workerImageExists, signEdgeImageUrl,
} from '@/lib/storage/edge-images-sign'
import {
  wantsImageBytes, imageRedirectOrBytes, staleFallbackForbidden, imageUnavailable,
} from '@/lib/storage/edge-image-response'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; cameraId: string }> },
) {
  const { id: edgeId, cameraId } = await ctx.params

  // Auth gate — same pattern as /grid.
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  // R2 優先（エグレス無料）。未移行エッジは Supabase へフォールバック。
  // 経路1: 自社ドメインの Worker（SNI 遮断回線でも通る）。経路2: R2 の S3 API 直。
  const key = snapshotKey(edgeId, cameraId)
  if (edgeImagesWorkerConfigured() && (await workerImageExists(key))) {
    const url = signEdgeImageUrl('GET', key)
    if (url) return imageRedirectOrBytes(url, wantsImageBytes(req))
  }
  if (edgeImagesR2Configured() && (await edgeImageExists(key))) {
    const url = await presignEdgeImageGet(key)
    return imageRedirectOrBytes(url, wantsImageBytes(req))
  }

  // R2/Worker 構成済みなら Supabase は必ず古い（エッジが書かなくなったため）。
  // 古いフレームを黙って出さず、取得失敗として返す。
  if (staleFallbackForbidden()) return imageUnavailable()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const objectPath  = `edges/${edgeId}/cam/${cameraId}/snapshot.jpg`
  // `?t=` cache-buster — see grid/route.ts for the rationale. Without it
  // Supabase Storage's authenticated download endpoint returns stale CDN
  // bytes even when the object is being replaced every second.
  const storageUrl  = `${supabaseUrl}/storage/v1/object/authenticated/edge-grids/${objectPath}?t=${Date.now()}`

  const res = await fetch(storageUrl, {
    headers: {
      // New-format Supabase secret keys (sb_secret_…) need the `apikey` header,
      // not just Bearer — the Storage gateway rejects Bearer-only. Same fix as
      // the grid route.
      'apikey':        serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Cache-Control': 'no-cache',
      'Pragma':        'no-cache',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    return new NextResponse(null, { status: res.status === 404 ? 404 : 502 })
  }

  const buf = await res.arrayBuffer()
  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type':  'image/jpeg',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Pragma':        'no-cache',
    },
  })
}
