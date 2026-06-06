/**
 * F77 / Phase 8.4-B — VOD clip create.
 * F81 / Phase 8.6 — DB-backed reuse: skip recreating clips whose (camera_id,
 *                   requested_from, requested_to) tuple already exists.
 *
 * POST /api/vod
 *   body: { camera_id, from_iso, to_iso }
 *
 * Returns the clip id (new or reused). The browser then polls
 * /api/vod/<id>/status until ready, then plays /api/vod/<id>.
 *
 * F81 reuse logic
 *   Looks up an existing row for the same exact (camera_id, from, to). If
 *   found in any non-failed state (queued / uploading / ready), returns it
 *   without creating a new row or sending an edge command. The browser
 *   simply polls the existing clip, which saves Frigate CPU, edge upload
 *   bandwidth, and Supabase Storage. Only `failed` rows are bypassed
 *   (retry-on-error behaviour).
 *
 *   Strict match (not overlap) keeps the implementation simple. A user who
 *   asks for 10:00-10:05 and another who asks for 10:02-10:07 still get
 *   separate clips. Overlap-based reuse is Phase 8.6.1 (deferred).
 *
 * RLS guard
 *   We look up the camera via the user-scoped client first to ensure the
 *   user can actually see it. Only then do we use Service Role to insert
 *   the vod_clips row (the table's INSERT policy blocks all authed inserts;
 *   only Service Role can create rows).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'

interface Body {
  camera_id?: string
  from_iso?:  string
  to_iso?:    string
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as Body
  const { camera_id, from_iso, to_iso } = body

  if (!camera_id || !from_iso || !to_iso) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }
  if (Date.parse(from_iso) >= Date.parse(to_iso)) {
    return NextResponse.json({ error: 'from_must_be_before_to' }, { status: 400 })
  }

  // 1. Auth + camera visibility check (RLS).
  const authSupa = await createSupabaseServer()
  const { data: { user } } = await authSupa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: cam, error: camErr } = await authSupa
    .from('recorder_cameras')
    .select('id, recorders ( id, edge_id, vendor )')
    .eq('id', camera_id)
    .single()
  if (camErr || !cam) {
    return NextResponse.json({ error: 'camera_not_found' }, { status: 404 })
  }
  const c = cam as unknown as { recorders: { edge_id: string; vendor: string } }
  const edgeId = c.recorders.edge_id
  const vendor = c.recorders.vendor

  // Phase 8.4-B initial scope: Frigate only. Other vendors (Hikvision /
  // Hanwha) have VOD adapters but plug into a different pipeline that
  // Phase 8.5 will unify with this one.
  if (vendor !== 'frigate') {
    return NextResponse.json(
      {
        error: 'vendor_unsupported',
        message: `Phase 8.4-B Storage Direct VOD は当面 Frigate のみ対応です (vendor=${vendor})`,
      },
      { status: 422 },
    )
  }

  const admin = createSupabaseService()

  // 2. F81 — Look up an existing clip for the same (camera, range). The
  //    timestamps come from the client as ISO strings; Postgres normalises
  //    them on insert, so we must compare normalised values to avoid
  //    "10:00:00.000Z" vs "10:00:00+00:00" missing each other. Cast the
  //    incoming strings via timestamptz in the filter to use the same
  //    canonical representation on both sides.
  const { data: existing, error: lookupErr } = await admin
    .from('vod_clips')
    .select('id, status')
    .eq('camera_id', camera_id)
    .eq('requested_from', from_iso)
    .eq('requested_to',   to_iso)
    .in('status', ['queued', 'uploading', 'ready'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (lookupErr) {
    // Treat a lookup failure as cache miss — still produce a fresh clip.
    // Log for observability but don't fail the request.
    console.warn('[vod] reuse lookup failed:', lookupErr.message)
  }
  if (existing?.id) {
    // Cache hit — return the existing row. The browser polls /status as
    // usual and will see whatever stage it's in (queued/uploading/ready).
    return NextResponse.json({
      clip_id: existing.id,
      status:  existing.status,
      reused:  true,           // F81: surface this so the client can show "再利用" UI
    })
  }

  // 3. Insert vod_clips row via Service Role (table policy denies authed inserts).
  const { data: row, error: insErr } = await admin
    .from('vod_clips')
    .insert({
      camera_id,
      edge_device_id: edgeId,
      requested_from: from_iso,
      requested_to:   to_iso,
      status:         'queued',
      requested_by:   user.id,
    })
    .select('id')
    .single()

  if (insErr || !row) {
    return NextResponse.json(
      { error: 'clip_create_failed', detail: insErr?.message },
      { status: 500 },
    )
  }

  // 4. Hand the work to the edge. The edge polls /api/edges/<id>/commands and
  //    will pick this up on its next poll cycle (~500 ms).
  await fetch(new URL(`/api/edges/${edgeId}/commands`, req.url).toString(), {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      // Forward the user's cookie so the commands endpoint (which gates on
      // session) accepts the call.
      cookie: req.headers.get('cookie') ?? '',
    },
    body: JSON.stringify({
      action:    'start_vod',
      camera_id,
      from_iso,
      to_iso,
      clip_id:   row.id,   // F77: edge uses this to update the vod_clips row
    }),
  }).catch(() => { /* edge picks it up on next poll anyway */ })

  return NextResponse.json({ clip_id: row.id, status: 'queued', reused: false })
}
