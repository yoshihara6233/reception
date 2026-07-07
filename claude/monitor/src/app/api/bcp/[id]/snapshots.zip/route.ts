/**
 * GET /api/bcp/<eventId>/snapshots.zip
 *
 * F40: Bulk-download every JPEG snapshot for a BCP event as a single ZIP.
 *
 * Layout inside the ZIP:
 *   <store_name>/<camera_name>/<offsetLabel>.jpg
 * Example:
 *   渋谷南店/レジ前カメラ/m5_5分前.jpg
 *   渋谷南店/レジ前カメラ/p0_発生時.jpg
 *   渋谷南店/レジ前カメラ/p5_5分後.jpg
 *   ...
 *
 * Legacy video clips (offset_min IS NULL) are NOT included — only the
 * F40-style snapshots. The detail page exposes legacy clips as individual
 * download links instead.
 */
import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import { createSupabaseServer } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { recordFootageAccess } from '@/lib/audit/footage-access'

interface ClipRow {
  id:            string
  offset_min:    number | null
  // F76: storage_path replaces clip_url as the source of truth.
  storage_path:  string | null
  clip_url:      string | null
  upload_status: string
  recorder_cameras: { id: string; name: string } | null
}
interface EventRow {
  id:              string
  alert_issued_at: string
  stores:          { id: string; name: string } | null
}

function offsetSlug(min: number): string {
  if (min === 0)  return 'p0_発生時'
  if (min < 0)    return `m${Math.abs(min)}_${Math.abs(min)}分前`
  return `p${min}_${min}分後`
}

/** Sanitize a name fragment so it works as a path component on Windows/macOS. */
function safeName(s: string | null | undefined, fallback: string): string {
  const v = (s ?? fallback).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
  return v.length > 0 ? v : fallback
}

export async function GET(
  _req: Request,
  ctx:  { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params

  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  // Fetch event (for naming + permission check via RLS)
  const { data: eventData } = await supa
    .from('bcp_events')
    .select('id, alert_issued_at, stores ( id, name )')
    .eq('id', id)
    .single()
  if (!eventData) return new NextResponse('Not Found', { status: 404 })
  const event = eventData as unknown as EventRow

  // G3: 証跡エクスポート（ZIPダウンロード）の閲覧アクセスを記録（best-effort・5分dedup）。
  await recordFootageAccess({
    actorUserId: user.id, storeId: event.stores?.id ?? null,
    accessType: 'bcp_export', resourceId: id,
  })

  // Fetch snapshots only (offset_min IS NOT NULL)
  const { data: clipData } = await supa
    .from('bcp_clips')
    .select('id, offset_min, storage_path, clip_url, upload_status, recorder_cameras ( id, name )')
    .eq('event_id', id)
    .not('offset_min', 'is', null)
    .order('camera_id', { ascending: true })
    .order('offset_min', { ascending: true })

  const clips = ((clipData ?? []) as unknown as ClipRow[])
    .filter((c) => (c.storage_path || c.clip_url) && c.upload_status === 'completed')

  if (clips.length === 0) {
    return new NextResponse('No snapshots available', { status: 404 })
  }

  // F76: Service Role for direct bucket download. The bucket is Private as
  // of Phase 8 — we no longer fetch the public URL.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    return new NextResponse('Server misconfigured', { status: 500 })
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Build the zip
  const zip = new JSZip()
  const storeFolder = safeName(event.stores?.name, 'store')

  await Promise.all(clips.map(async (c) => {
    try {
      let buf: Buffer | null = null

      if (c.storage_path) {
        // F76: pull the object directly via Service Role (bypasses Storage RLS).
        const { data, error } = await admin.storage
          .from('bcp-clips')
          .download(c.storage_path)
        if (error || !data) return
        buf = Buffer.from(await data.arrayBuffer())
      } else if (c.clip_url) {
        // Legacy fallback: row predates F76 and only has a public URL.
        // Works while the bucket is still Public; quietly skipped after flip.
        const r = await fetch(c.clip_url, { cache: 'no-store' })
        if (!r.ok) return
        buf = Buffer.from(await r.arrayBuffer())
      }

      if (!buf) return
      const camFolder = safeName(c.recorder_cameras?.name, c.recorder_cameras?.id ?? 'camera')
      const filename  = `${offsetSlug(c.offset_min ?? 0)}.jpg`
      zip.file(`${storeFolder}/${camFolder}/${filename}`, buf)
    } catch {
      // skip individual failures — the user will see whatever made it in
    }
  }))

  const zipBuf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'STORE',  // JPEG is already compressed; no benefit from DEFLATE
  })

  const issuedAt = event.alert_issued_at.slice(0, 19).replace(/[:T]/g, '-')
  const fname    = `bcp_${storeFolder}_${issuedAt}.zip`

  return new NextResponse(new Uint8Array(zipBuf), {
    status: 200,
    headers: {
      'Content-Type':        'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fname)}"`,
      'Cache-Control':       'no-store',
    },
  })
}
