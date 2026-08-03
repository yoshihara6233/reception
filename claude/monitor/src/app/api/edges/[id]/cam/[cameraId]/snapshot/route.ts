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

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; cameraId: string }> },
) {
  const { id: edgeId, cameraId } = await ctx.params

  // Auth gate — same pattern as /grid.
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  // R2 優先（エグレス無料）。未移行エッジは Supabase へフォールバック。
  const key = snapshotKey(edgeId, cameraId)
  if (edgeImagesR2Configured() && (await edgeImageExists(key))) {
    const url = await presignEdgeImageGet(key)
    return NextResponse.redirect(url, {
      status: 302,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  }

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
