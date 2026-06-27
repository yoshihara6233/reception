/**
 * POST /api/bcp-webhook
 *
 * Called (by the Supabase edge-function poller or an external trigger) after
 * all camera clips for a BCP event have been uploaded.
 *
 * Request body  : { eventId: string }
 * Authorization : Bearer <BCP_WEBHOOK_SECRET>
 *
 * Flow:
 *  1. Validate Authorization header
 *  2. Fetch bcp_events row (+ store + bcp_settings)
 *  3. Guard: status must be 'clips_uploaded'
 *  4. Fetch bcp_clips with JOIN on recorder_cameras for camera name
 *  5. Generate PDF
 *  6. Insert bcp_reports row (placeholder url)
 *  7. Upload PDF to Supabase Storage bucket "bcp-reports"
 *  8. Update bcp_reports.pdf_url with the auth-gated proxy path
 *  9. Update bcp_events.status = 'report_generated'
 * 10. Send bcpCompletedEmail to bcp_settings.notify_emails
 * 11. Update bcp_events.status = 'completed'
 * 12. Return { ok: true }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateBcpReportPdf, type BcpReportProps } from '@/lib/pdf/bcp-report'
import { sendEmail, bcpCompletedEmail } from '@/lib/email/send'

// ---------------------------------------------------------------------------
// Types matching DB rows
// ---------------------------------------------------------------------------

interface BcpEventRow {
  id: string
  store_id: string | null
  alert_type: string
  alert_issued_at: string
  area_code: string | null
  status: string
  is_test: boolean
  stores: {
    name: string
    address: string | null
  } | null
}

interface BcpClipRow {
  id: string
  camera_id: string | null
  clip_from: string
  clip_to: string
  clip_url: string | null
  storage_path: string | null
  duration_sec: number | null
  upload_status: string
  recorder_cameras: {
    name: string
  } | null
}

// ---------------------------------------------------------------------------
// Supabase service client (bypasses RLS)
// ---------------------------------------------------------------------------

function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 1. Validate Authorization header
  const secret = process.env.BCP_WEBHOOK_SECRET
  if (!secret) {
    console.error('[bcp-webhook] BCP_WEBHOOK_SECRET is not configured')
    return NextResponse.json({ error: 'server_misconfiguration' }, { status: 500 })
  }

  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Parse body
  let body: { eventId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { eventId } = body
  if (!eventId || typeof eventId !== 'string') {
    return NextResponse.json({ error: 'eventId_required' }, { status: 400 })
  }

  const supa = createServiceClient()

  try {
    // 2. Fetch bcp_events row with store + bcp_settings
    const { data: eventRow, error: eventErr } = await supa
      .from('bcp_events')
      .select(`
        id,
        store_id,
        alert_type,
        alert_issued_at,
        area_code,
        status,
        is_test,
        stores ( name, address )
      `)
      .eq('id', eventId)
      .single()

    if (eventErr || !eventRow) {
      console.error('[bcp-webhook] Event not found:', eventId, eventErr?.message)
      return NextResponse.json({ error: 'event_not_found' }, { status: 404 })
    }

    const event = eventRow as unknown as BcpEventRow

    // 2b. Fetch BCP settings separately. There is NO foreign-key relationship
    // between bcp_events and bcp_settings (both relate via stores), so PostgREST
    // cannot embed `bcp_settings ( notify_emails )` into the event select —
    // doing so made the whole fetch error with "Could not find a relationship …
    // in the schema cache", which this route reported as 404 event_not_found.
    // The result: the sweep retried forever, no PDF/email was sent, and status
    // stayed 'clips_uploaded'. See investigate 2026-06-27 (event 1127abc5…).
    const { data: settingsRow } = event.store_id
      ? await supa
          .from('bcp_settings')
          .select('notify_emails')
          .eq('store_id', event.store_id)
          .maybeSingle()
      : { data: null }
    const notifyEmails = (settingsRow?.notify_emails ?? []) as string[]

    // 3. Idempotency guard
    if (event.status !== 'clips_uploaded') {
      console.warn(
        `[bcp-webhook] Event ${eventId} has status '${event.status}', expected 'clips_uploaded' — skipping`,
      )
      return NextResponse.json(
        { error: 'invalid_status', status: event.status },
        { status: 409 },
      )
    }

    // 4. Fetch bcp_clips with camera name via JOIN
    const { data: clipRows, error: clipsErr } = await supa
      .from('bcp_clips')
      .select(`
        id,
        camera_id,
        clip_from,
        clip_to,
        clip_url,
        storage_path,
        duration_sec,
        upload_status,
        recorder_cameras ( name )
      `)
      .eq('event_id', eventId)
      .order('clip_from', { ascending: true })

    if (clipsErr) {
      console.error('[bcp-webhook] Failed to fetch clips:', clipsErr.message)
      return NextResponse.json({ error: 'clips_fetch_failed' }, { status: 500 })
    }

    const clips = (clipRows ?? []) as unknown as BcpClipRow[]

    // 4b. Resolve each snapshot to a short-lived signed URL. The bcp-clips
    // bucket is Private (Phase 8), so the legacy public clip_url returns 403 —
    // embedding it made @react-pdf fail with "Not valid image extension" and the
    // PDF came out with empty image boxes. Sign via the service-role client
    // (bypasses Storage RLS), matching the generate-report route. See
    // investigate 2026-06-27 (event 1127abc5…).
    const SIGNED_TTL = 300
    const imageByClip = new Map<string, string>()
    await Promise.all(
      clips
        .filter((c) => c.upload_status === 'completed' && c.storage_path)
        .map(async (c) => {
          const { data, error } = await supa.storage
            .from('bcp-clips')
            .createSignedUrl(c.storage_path!, SIGNED_TTL)
          if (error || !data?.signedUrl) {
            console.warn('[bcp-webhook] clip image signing failed:', c.id, error?.message)
            return
          }
          imageByClip.set(c.id, data.signedUrl)
        }),
    )

    // 5. Generate PDF
    const generatedAt = new Date().toISOString()
    const store = event.stores ?? { name: '(不明)', address: null }

    const pdfProps: BcpReportProps = {
      event: {
        id:             event.id,
        alertType:      event.alert_type,
        alertIssuedAt:  event.alert_issued_at,
        areaCode:       event.area_code ?? '',
        status:         event.status,
        isTest:         event.is_test,
      },
      store: {
        name:    store.name,
        address: store.address ?? undefined,
      },
      clips: clips.map((c) => ({
        id:           c.id,
        cameraName:   c.recorder_cameras?.name ?? '(不明)',
        clipFrom:     c.clip_from,
        clipTo:       c.clip_to,
        durationSec:  c.duration_sec ?? 0,
        clipUrl:      imageByClip.get(c.id) ?? undefined,
        uploadStatus: c.upload_status,
      })),
      generatedAt,
    }

    let pdfBuffer: Buffer
    try {
      pdfBuffer = await generateBcpReportPdf(pdfProps)
    } catch (pdfErr) {
      console.error('[bcp-webhook] PDF generation failed:', pdfErr)
      return NextResponse.json({ error: 'pdf_generation_failed' }, { status: 500 })
    }

    // 6. Insert bcp_reports row with placeholder url
    const { data: reportRow, error: reportInsertErr } = await supa
      .from('bcp_reports')
      .insert({
        event_id:     eventId,
        pdf_url:      '',
        generated_at: generatedAt,
      })
      .select('id')
      .single()

    if (reportInsertErr || !reportRow) {
      console.error('[bcp-webhook] Failed to insert bcp_reports:', reportInsertErr?.message)
      return NextResponse.json({ error: 'report_insert_failed' }, { status: 500 })
    }

    const reportId = reportRow.id as string

    // 7. Upload PDF to Supabase Storage
    const storageKey = `${eventId}/report.pdf`
    const { error: uploadErr } = await supa.storage
      .from('bcp-reports')
      .upload(storageKey, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      })

    if (uploadErr) {
      console.error('[bcp-webhook] Storage upload failed:', uploadErr.message)
      // Non-fatal: continue without a URL
    }

    // 8. Store the auth-gated proxy path (NOT a public bucket URL). The
    //    bcp-reports bucket is Private; /api/bcp/<eventId>/report verifies the
    //    session and redirects to a short-lived signed URL on demand.
    const pdfUrl = `/api/bcp/${eventId}/report`

    const { error: reportUpdateErr } = await supa
      .from('bcp_reports')
      .update({ pdf_url: pdfUrl })
      .eq('id', reportId)

    if (reportUpdateErr) {
      console.warn('[bcp-webhook] Failed to update report url:', reportUpdateErr.message)
      // Non-fatal — carry on
    }

    // 9. Update bcp_events.status = 'report_generated'
    const { error: statusErr1 } = await supa
      .from('bcp_events')
      .update({ status: 'report_generated' })
      .eq('id', eventId)

    if (statusErr1) {
      console.warn('[bcp-webhook] Failed to set status=report_generated:', statusErr1.message)
    }

    // 10. Send completion email
    const recipients = notifyEmails
    if (recipients.length > 0) {
      try {
        const alertTime = new Date(event.alert_issued_at).toLocaleString('ja-JP', {
          timeZone: 'Asia/Tokyo',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit',
        })

        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
        const eventUrl = appUrl ? `${appUrl}/bcp/events/${eventId}` : `/bcp/events/${eventId}`

        const { subject, html } = bcpCompletedEmail({
          storeName:  store.name,
          alertType:  event.alert_type,
          alertTime,
          eventUrl,
          isTest:     event.is_test,
          clipCount:  clips.length,
        })

        await sendEmail(
          recipients,
          subject,
          html,
          [{ filename: 'bcp-report.pdf', content: pdfBuffer }],
        )
      } catch (emailErr) {
        console.error('[bcp-webhook] Email send failed:', emailErr)
        // Non-fatal — do not fail the whole webhook
      }
    }

    // 11. Update bcp_events.status = 'completed'
    const { error: statusErr2 } = await supa
      .from('bcp_events')
      .update({ status: 'completed' })
      .eq('id', eventId)

    if (statusErr2) {
      console.warn('[bcp-webhook] Failed to set status=completed:', statusErr2.message)
    }

    // 12. Return success
    return NextResponse.json({ ok: true, reportId, pdfUrl })
  } catch (err) {
    console.error('[bcp-webhook] Unexpected error:', err)
    return NextResponse.json(
      { error: 'internal_error', message: String(err) },
      { status: 500 },
    )
  }
}
