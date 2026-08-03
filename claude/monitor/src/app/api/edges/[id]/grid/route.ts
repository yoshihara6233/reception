/**
 * Proxy the latest grid JPEG for an edge device.
 * Uses the Supabase Storage REST API directly (not the JS SDK) to bypass
 * any SDK-level caching and ensure the freshest JPEG is always returned.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import {
  edgeImagesR2Configured, edgeImageExists, presignEdgeImageGet, gridKey,
} from '@/lib/storage/edge-images-r2'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: edgeId } = await ctx.params

  // Auth check
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  // R2 優先（エグレス無料）。オブジェクトが無いエッジ＝未移行なので Supabase へ落ちる。
  // 毎フレーム Supabase から取り直すと課金エグレスが視聴1時間あたり約0.5GB出る。
  if (edgeImagesR2Configured() && (await edgeImageExists(gridKey(edgeId)))) {
    const url = await presignEdgeImageGet(gridKey(edgeId))
    return NextResponse.redirect(url, {
      status: 302,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  }

  // Fetch directly from the Storage REST API with service_role key.
  // Using native fetch with cache: 'no-store' bypasses Next.js fetch cache
  // and any internal SDK caching, guaranteeing a fresh response every call.
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
