/**
 * BCP report PDF proxy with signed URL (mirrors the F76 bcp-clips proxy).
 *
 * The bcp-reports bucket is Private. The completion PDF embeds store-interior
 * camera snapshots, so a public URL (guessable per-event or screenshot-shared)
 * is an exposure. To download a report from the authenticated /bcp pages the
 * browser requests:
 *
 *     GET /api/bcp/<eventId>/report
 *
 * This route:
 *  1. Verifies the caller has a monitor session.
 *  2. Reads bcp_reports for the event with the user-scoped client so RLS gates
 *     whether this user may see the event's report at all.
 *  3. Issues a short-lived (60 s) Service-Role signed URL for the deterministic
 *     storage key `<eventId>/report.pdf`.
 *  4. Redirects the browser to the signed URL.
 *
 * The completion email is unaffected: it attaches the PDF bytes directly and
 * links to the (auth-gated) event page, never to a bucket URL.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

const BUCKET     = 'bcp-reports'
const SIGNED_TTL = 60   // seconds — outlives the single redirect fetch

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: eventId } = await ctx.params

  // 1. Auth gate.
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // 2. RLS-gated visibility check: the user-scoped read returns a row only if
  //    this user may see the event's report. We don't need the row's contents
  //    — the storage key is deterministic — but its existence both confirms a
  //    PDF was generated and authorizes the download.
  const { data: report, error: reportErr } = await supa
    .from('bcp_reports')
    .select('id')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (reportErr || !report) {
    return new NextResponse('Not Found', { status: 404 })
  }

  // 3. Sign the PDF via Service Role (bypasses Storage RLS; authz already done
  //    by the session + bcp_reports RLS read above).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('[bcp/report] missing SUPABASE service-role env')
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const storageKey = `${eventId}/report.pdf`
  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(storageKey, SIGNED_TTL, { download: 'bcp-report.pdf' })

  if (signErr || !signed?.signedUrl) {
    console.error('[bcp/report] signing failed', signErr?.message)
    return new NextResponse('Signed URL unavailable', { status: 502 })
  }

  // 4. Hand the browser the short-lived URL. no-store so the redirect isn't
  //    cached past the TTL.
  return NextResponse.redirect(signed.signedUrl, {
    status: 302,
    headers: { 'Cache-Control': 'no-store' },
  })
}
