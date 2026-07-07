/**
 * Patrol snapshot proxy with signed URL (mirrors the F76 bcp-clips proxy).
 *
 * The security-snapshots bucket is Private (see 20260529_002_security.sql —
 * "ingest API は service-role で書込み・署名URLで読取り"). The patrol ingest
 * route used to store a getPublicUrl() value in patrol_findings.snapshot_url,
 * which does not resolve on a private bucket (and would be an exposure of
 * store-interior camera frames if the bucket were ever flipped public). This
 * route is the intended read path:
 *
 *     GET /api/security/patrol/<runId>/<cameraId>/snapshot
 *
 *  1. Verifies the caller has a monitor session.
 *  2. RLS-gates via a user-scoped patrol_findings read (run_id + camera_id).
 *  3. Signs the deterministic storage object `<runId>/<cameraId>.<ext>` with
 *     Service Role (the ingest writes .jpg, or .png for image/png uploads, so
 *     we probe jpg first then png).
 *  4. Redirects the browser to the short-lived signed URL.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { recordFootageAccess } from '@/lib/audit/footage-access'

const BUCKET     = 'security-snapshots'
const SIGNED_TTL = 60   // seconds — outlives the single redirect fetch

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ runId: string; cameraId: string }> },
) {
  const { runId, cameraId } = await ctx.params

  // 1. Auth gate.
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  // 2. RLS-gated visibility check: the user-scoped read returns a row only if
  //    this user may see the finding. Existence also confirms a snapshot was
  //    ingested for this run+camera.
  const { data: finding, error: findErr } = await supa
    .from('patrol_findings')
    .select('id, patrol_runs ( store_id )')
    .eq('run_id', runId)
    .eq('camera_id', cameraId)
    .maybeSingle()

  if (findErr || !finding) {
    return new NextResponse('Not Found', { status: 404 })
  }

  // G3: 証跡静止画の閲覧アクセスを記録（best-effort・5分dedup）。
  const run = (finding as { patrol_runs?: { store_id?: string | null } | { store_id?: string | null }[] }).patrol_runs
  const storeId = (Array.isArray(run) ? run[0]?.store_id : run?.store_id) ?? null
  await recordFootageAccess({
    actorUserId: user.id, storeId, accessType: 'patrol_snapshot',
    resourceId: `${runId}:${cameraId}`, cameraId,
  })

  // 3. Sign via Service Role (bypasses Storage RLS; authz already done above).
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('[security/patrol/snapshot] missing SUPABASE service-role env')
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // ingest writes `${runId}/${cameraId}.jpg` (or .png for PNG uploads); probe
  // jpg first since that is the common case.
  for (const ext of ['jpg', 'png'] as const) {
    const { data: signed } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(`${runId}/${cameraId}.${ext}`, SIGNED_TTL)
    if (signed?.signedUrl) {
      return NextResponse.redirect(signed.signedUrl, {
        status: 302,
        headers: { 'Cache-Control': 'no-store' },
      })
    }
  }

  return new NextResponse('Snapshot not found', { status: 404 })
}
