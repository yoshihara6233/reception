/**
 * F77 / Phase 8.4-B — VOD MP4 playback proxy.
 *
 * GET /api/vod/<clipId>
 *
 * Verifies the session (RLS on vod_clips already filters by tenant), issues
 * a 10-minute signed URL for the underlying MP4 in the Private vod-clips
 * bucket, and 302-redirects.
 *
 * Why 10 minutes? Mirrors the legacy LiveKit TTL (90 min was too generous
 * for a 5-minute clip and let URL-leak attacks linger). A 10-minute window
 * is plenty for the user to fully watch a typical 5-minute window even
 * with pauses, and the browser only resolves the URL when <video src=...>
 * mounts — Range requests inherit the same signature for the same lifetime.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createSupabaseServer } from '@/lib/supabase/server'

const BUCKET     = 'vod-clips'
const SIGNED_TTL = 10 * 60

export async function GET(
  _req: NextRequest,
  ctx:  { params: Promise<{ clipId: string }> },
): Promise<NextResponse> {
  const { clipId } = await ctx.params

  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const { data: clip, error: clipErr } = await supa
    .from('vod_clips')
    .select('id, status, storage_path')
    .eq('id', clipId)
    .single()

  if (clipErr || !clip) {
    return new NextResponse('Not Found', { status: 404 })
  }
  if (clip.status !== 'ready' || !clip.storage_path) {
    return new NextResponse(`Clip not ready (status=${clip.status})`, { status: 425 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('[vod] missing SUPABASE service-role env')
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(clip.storage_path, SIGNED_TTL)

  if (signErr || !signed?.signedUrl) {
    console.error('[vod] sign failed', signErr?.message)
    return new NextResponse('Signed URL unavailable', { status: 502 })
  }

  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: { 'Cache-Control': 'no-store' },
  })
}
