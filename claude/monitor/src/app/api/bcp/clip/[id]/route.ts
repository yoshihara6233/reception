/**
 * F76 / Phase 8.3 — bcp_clips proxy with signed URL.
 *
 * The bcp-clips bucket is Private as of Phase 8. To display a clip in the
 * /bcp/[eventId] page (or any other authenticated context), the browser
 * requests:
 *
 *     GET /api/bcp/clip/<clipId>
 *
 * This route:
 *  1. Verifies the caller has a session.
 *  2. Looks up bcp_clips.storage_path (falling back to legacy clip_url for
 *     pre-F76 rows that still have a public URL).
 *  3. Issues a short-lived (60 s) signed URL via Service Role.
 *  4. Redirects the browser to the signed URL.
 *
 * Why redirect instead of streaming through the proxy?
 *   Streaming would route every image byte through Next.js, which is fine
 *   for a few thumbnails but costly when a /bcp/[id] page renders 8 × N
 *   snapshots at once. A 302 hands the work back to Supabase's CDN with
 *   the same authorization scope (the signed URL).
 *
 * Why 60 s TTL?
 *   The image element follows the redirect immediately, so the TTL only
 *   needs to outlive that single fetch. 60 s gives margin for slow phones
 *   without leaving the URL useful for screenshot-and-share leaks.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

const BUCKET     = 'bcp-clips'
const SIGNED_TTL = 60   // seconds

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: clipId } = await ctx.params

  // 1. Auth gate. The user must have an active monitor session.
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // 2. Look up the clip. Use the user-scoped client so RLS gates which
  //    clips this user can see (same tenant, etc.). storage_path is the
  //    primary key for the signed URL; clip_url is the legacy fallback.
  const { data: clip, error: clipErr } = await supa
    .from('bcp_clips')
    .select('id, storage_path, clip_url')
    .eq('id', clipId)
    .single()

  if (clipErr || !clip) {
    return new NextResponse('Not Found', { status: 404 })
  }

  // 3a. Legacy path — old PoC rows with no storage_path but a public URL.
  //     Redirect straight there. This will stop working when the bucket
  //     is flipped to Private; the migration backfills storage_path for
  //     rows whose URL contained '/bcp-clips/'. Anything left here is
  //     truly orphan and we serve a 404 once the bucket is private.
  if (!clip.storage_path) {
    if (clip.clip_url) {
      return NextResponse.redirect(clip.clip_url, { status: 302 })
    }
    return new NextResponse('Clip has no storage_path or clip_url', { status: 410 })
  }

  // 3b. Sign URL via Service Role. The user-scoped client can also create
  //     signed URLs but only for objects covered by Storage RLS policies,
  //     which we haven't authored for bcp-clips yet (and which would be
  //     hard to express: "can read snapshots whose event.store_id is in
  //     my tenant"). Service Role bypasses Storage RLS — security comes
  //     from the Supabase auth check above + the bcp_clips RLS check via
  //     the user-scoped read.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('[bcp/clip] missing SUPABASE service-role env')
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(clip.storage_path, SIGNED_TTL)

  if (signErr || !signed?.signedUrl) {
    console.error('[bcp/clip] signing failed', signErr?.message)
    return new NextResponse('Signed URL unavailable', { status: 502 })
  }

  // 4. Hand the browser the short-lived URL. Cache-Control: no-store so
  //    the redirect itself isn't cached past the TTL.
  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: { 'Cache-Control': 'no-store' },
  })
}
