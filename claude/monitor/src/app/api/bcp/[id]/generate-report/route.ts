/**
 * F60: POST /api/bcp/[id]/generate-report
 *
 * BCP イベントから PDF レポートを手動生成する。
 *
 * 用途:
 *   - テスト発令 (`/api/bcp/test`) で作成した event の PDF 生成
 *   - 本番アラート (webhook 経由) で PDF 生成に失敗した event の再試行
 *   - 将来 (Phase 8): edge-agent が 8 枚撮影完了後に呼び出して自動化
 *
 * 認証: セッション (ログイン済ユーザ)
 *
 * 動作:
 *   1. セッション認証チェック
 *   2. bcp_events を取得 (store + bcp_settings 含む)
 *   3. bcp_clips を取得 (camera 名含む)
 *   4. PDF 生成
 *   5. bcp_reports 行を upsert (既存ならスキップ可)
 *   6. Storage `bcp-reports/<eventId>/report.pdf` にアップロード
 *   7. bcp_reports.pdf_url 更新
 *   8. bcp_events.status = 'report_generated' (もし更に進んでいなければ)
 *   9. レスポンス { ok, reportId, pdfUrl }
 *
 * webhook (`/api/bcp-webhook`) との違い:
 *   - 認証: webhook secret → session
 *   - status 制約: 'clips_uploaded' のみ → 任意 (より寛容)
 *   - メール送信: 行う → スキップ (手動操作のためメール不要)
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { generateBcpReportPdf, type BcpReportProps } from '@/lib/pdf/bcp-report'

interface BcpEventRow {
  id:               string
  store_id:         string | null
  alert_type:       string
  alert_issued_at:  string
  area_code:        string | null
  max_intensity:    string | null
  status:           string
  is_test:          boolean
  stores: {
    name:    string
    address: string | null
  } | null
}

interface BcpClipRow {
  id:               string
  camera_id:        string | null
  clip_from:        string
  clip_to:          string
  // F76: storage_path is the source of truth; clip_url stays for legacy rows.
  storage_path:     string | null
  clip_url:         string | null
  duration_sec:     number | null
  upload_status:    string
  offset_min:       number | null
  recorder_cameras: {
    name: string
  } | null
}

// F76: TTL for the signed URL handed to React-PDF. The PDF generator fetches
// each image once during render; 300 s gives generous headroom for 8 cameras
// × 8 snapshots even on a slow runtime.
const PDF_SIGNED_TTL = 300

export async function POST(
  req:     NextRequest,
  ctx:     { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: eventId } = await ctx.params

  // 1. Session auth
  const authSupa = await createSupabaseServer()
  const { data: { user } } = await authSupa.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 2. Service role for DB ops (bypass RLS)
  const supa = createSupabaseService()

  try {
    // Fetch event
    const { data: eventRow, error: eventErr } = await supa
      .from('bcp_events')
      .select(`
        id,
        store_id,
        alert_type,
        alert_issued_at,
        area_code,
        max_intensity,
        status,
        is_test,
        stores ( name, address )
      `)
      .eq('id', eventId)
      .single()

    if (eventErr || !eventRow) {
      return NextResponse.json({ error: 'event_not_found' }, { status: 404 })
    }
    const event = eventRow as unknown as BcpEventRow

    // 3. Fetch clips with camera name
    //    Skip placeholder rows (offset_min IS NULL) — those are from test API
    //    initial insert and don't correspond to actual snapshots.
    const { data: clipRows, error: clipsErr } = await supa
      .from('bcp_clips')
      .select(`
        id,
        camera_id,
        clip_from,
        clip_to,
        storage_path,
        clip_url,
        duration_sec,
        upload_status,
        offset_min,
        recorder_cameras ( name )
      `)
      .eq('event_id', eventId)
      .not('offset_min', 'is', null)
      .order('offset_min', { ascending: true })

    if (clipsErr) {
      return NextResponse.json({ error: 'clips_fetch_failed' }, { status: 500 })
    }
    const clips = (clipRows ?? []) as unknown as BcpClipRow[]

    // F76: For each clip, generate a short-lived signed URL that React-PDF
    // can fetch during render. Service Role bypasses Storage RLS so this
    // works even after the bucket is flipped to Private. Falls back to the
    // legacy clip_url for pre-F76 rows (public bucket transitional period).
    const clipUrlMap = new Map<string, string | undefined>()
    await Promise.all(clips.map(async (c) => {
      if (c.storage_path) {
        const { data: signed } = await supa.storage
          .from('bcp-clips')
          .createSignedUrl(c.storage_path, PDF_SIGNED_TTL)
        clipUrlMap.set(c.id, signed?.signedUrl)
      } else if (c.clip_url) {
        // Legacy: bucket may still be Public during transition, the URL
        // works as-is. After the bucket flips Private, this row's snapshot
        // simply won't render in the PDF — better than a hard failure.
        clipUrlMap.set(c.id, c.clip_url)
      } else {
        clipUrlMap.set(c.id, undefined)
      }
    }))

    if (clips.length === 0) {
      return NextResponse.json(
        { error: 'no_snapshots', message: 'No snapshots available for this event yet.' },
        { status: 422 },
      )
    }

    // 4. Generate PDF
    const generatedAt = new Date().toISOString()
    const store = event.stores ?? { name: '(不明)', address: null }

    const pdfProps: BcpReportProps = {
      event: {
        id:             event.id,
        alertType:      event.alert_type,
        alertIssuedAt:  event.alert_issued_at,
        areaCode:       event.area_code ?? '',
        maxIntensity:   event.max_intensity,
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
        // F76: signed URL (or legacy clip_url) — see clipUrlMap above.
        clipUrl:      clipUrlMap.get(c.id),
        uploadStatus: c.upload_status,
        offsetMin:    c.offset_min ?? null,
      })),
      generatedAt,
    }

    let pdfBuffer: Buffer
    try {
      pdfBuffer = await generateBcpReportPdf(pdfProps)
    } catch (pdfErr) {
      // Surface the actual error so we can debug from the browser network tab
      const errMsg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr)
      const errStack = pdfErr instanceof Error ? pdfErr.stack : undefined
      console.error('[generate-report] PDF generation failed:', errMsg, errStack)
      return NextResponse.json(
        {
          error:   'pdf_generation_failed',
          message: errMsg,
          // Include first 5 lines of stack for quick diagnosis (PoC only)
          stack:   errStack?.split('\n').slice(0, 5).join('\n'),
        },
        { status: 500 },
      )
    }

    // 5. Upsert bcp_reports — existing row gets pdf_url updated, otherwise new row
    const { data: existing } = await supa
      .from('bcp_reports')
      .select('id')
      .eq('event_id', eventId)
      .maybeSingle()

    let reportId: string
    if (existing?.id) {
      reportId = existing.id as string
    } else {
      const { data: inserted, error: insertErr } = await supa
        .from('bcp_reports')
        .insert({
          event_id:     eventId,
          pdf_url:      '',
          generated_at: generatedAt,
        })
        .select('id')
        .single()
      if (insertErr || !inserted) {
        return NextResponse.json({ error: 'report_insert_failed' }, { status: 500 })
      }
      reportId = inserted.id as string
    }

    // 6. Upload PDF to Storage
    const storageKey = `${eventId}/report.pdf`
    const { error: uploadErr } = await supa.storage
      .from('bcp-reports')
      .upload(storageKey, pdfBuffer, {
        contentType: 'application/pdf',
        upsert:      true,
      })

    if (uploadErr) {
      console.error('[generate-report] Storage upload failed:', uploadErr.message)
      // Non-fatal — return without pdfUrl
    }

    // 7. Store the auth-gated proxy path (NOT a public bucket URL). The
    //    bcp-reports bucket is Private; /api/bcp/<eventId>/report signs a fresh
    //    short-lived URL on each click, so re-generated PDFs are never stale
    //    and the report is not publicly reachable.
    const pdfUrl = `/api/bcp/${eventId}/report`

    await supa
      .from('bcp_reports')
      .update({ pdf_url: pdfUrl, generated_at: generatedAt })
      .eq('id', reportId)

    // 8. Advance event status if it's still earlier than 'report_generated'
    const advanceStatuses = new Set(['pending', 'recording', 'clips_uploaded'])
    if (advanceStatuses.has(event.status)) {
      await supa
        .from('bcp_events')
        .update({ status: 'report_generated' })
        .eq('id', eventId)
    }

    return NextResponse.json({
      ok:        true,
      reportId,
      pdfUrl,
      snapshotCount: clips.length,
    })
  } catch (err) {
    console.error('[generate-report] Unexpected error:', err)
    return NextResponse.json(
      { error: 'internal_error', message: String(err) },
      { status: 500 },
    )
  }
}
