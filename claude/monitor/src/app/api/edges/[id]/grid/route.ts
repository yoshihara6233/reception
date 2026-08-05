/**
 * Proxy the latest grid JPEG for an edge device.
 * Uses the Supabase Storage REST API directly (not the JS SDK) to bypass
 * any SDK-level caching and ensure the freshest JPEG is always returned.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireEdgeViewAccess } from '@/lib/edge/view-access'
import {
  edgeImagesR2Configured, edgeImageExists, presignEdgeImageGet, gridKey,
} from '@/lib/storage/edge-images-r2'
import {
  edgeImagesWorkerConfigured, workerImageExists, signEdgeImageUrl,
} from '@/lib/storage/edge-images-sign'
import {
  wantsImageBytes, imageRedirectOrBytes, staleFallbackForbidden, imageUnavailable,
} from '@/lib/storage/edge-image-response'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: edgeId } = await ctx.params

  // 認証 + **このエッジが見える利用者か**。以降は R2/service_role で RLS を踏まないので、
  // ここを通さないと edgeId を知るだけで他テナントの映像が取れる。
  const access = await requireEdgeViewAccess(edgeId)
  if (!access.ok) {
    return new NextResponse(access.status === 401 ? 'Unauthorized' : 'Forbidden', { status: access.status })
  }

  // R2 優先（エグレス無料）。オブジェクトが無いエッジ＝未移行なので Supabase へ落ちる。
  // 毎フレーム Supabase から取り直すと課金エグレスが視聴1時間あたり約0.5GB出る。
  //
  // 経路1: 自社ドメインの Worker。eo光のように `*.r2.cloudflarestorage.com` を
  // SNI 遮断する回線でも視聴できるため、S3 presigned より優先する。
  const key = gridKey(edgeId)
  if (edgeImagesWorkerConfigured() && (await workerImageExists(key))) {
    const url = signEdgeImageUrl('GET', key)
    if (url) return imageRedirectOrBytes(url, wantsImageBytes(req))
  }
  // 経路2: R2 の S3 API 直（Worker 未設定時）。
  if (edgeImagesR2Configured() && (await edgeImageExists(key))) {
    const url = await presignEdgeImageGet(key)
    return imageRedirectOrBytes(url, wantsImageBytes(req))
  }

  // Fetch directly from the Storage REST API with service_role key.
  // Using native fetch with cache: 'no-store' bypasses Next.js fetch cache
  // and any internal SDK caching, guaranteeing a fresh response every call.
  // R2/Worker 構成済みなら Supabase は必ず古い（エッジが書かなくなったため）。
  // 古いフレームを黙って出さず、取得失敗として返す。
  if (staleFallbackForbidden()) return imageUnavailable()

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const objectPath  = `edges/${edgeId}/grid.jpg`
  // The `?t=` cache-buster is critical: Supabase Storage's authenticated
  // download endpoint sits behind a CDN that caches by URL even when the
  // upload-side cacheControl is no-store. Without a unique URL per request,
  // we get stale bytes for ~minutes even though `list()` shows the object
  // is being replaced every 2s.
  const storageUrl  = `${supabaseUrl}/storage/v1/object/authenticated/edge-grids/${objectPath}?t=${Date.now()}`

  const res = await fetch(storageUrl, {
    headers: {
      // New-format Supabase secret keys (sb_secret_…) are rejected by the
      // Storage gateway when sent only as a Bearer token; the `apikey` header
      // is required (the JS SDK sends both). Legacy JWT service_role keys
      // worked with Bearer alone, hence this was missing originally.
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
