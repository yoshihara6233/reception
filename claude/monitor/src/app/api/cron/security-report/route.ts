/**
 * 警備 巡回レポート 日次生成 cron（Phase A / A4）。
 *
 * Vercel Cron が 1 日 1 回実行（vercel.json: 20:00 UTC = 05:00 JST → 直前の JST 1日を集計）。
 * 有効店舗ごとに、前日（JST 00:00〜24:00）の巡回サイクルを 1 本の PDF にまとめ:
 *   1. security_reports 行を起票（period = 前日 JST）
 *   2. 概要＋巡回履歴＋証跡コンタクトシート PDF を生成し reports バケットへアップロード
 *   3. pdf_url を更新し、notify_emails 宛に PDF 添付でメール送信
 * 冪等: 同一 (store_id, period_from) の行が既にあればスキップ（二重生成防止）。
 *
 * 認証: edge-health / security-patrol と同じ CRON_SECRET。
 */
import { NextRequest, NextResponse } from 'next/server'
import { Buffer } from 'node:buffer'
import { createSupabaseService } from '@/lib/supabase/server'
import { sendEmail, SECURITY_FROM_ADDRESS } from '@/lib/email/send'
import { buildPatrolReportPdf, type ReportRun, type ReportFinding } from '@/lib/security/patrol-report'

export const runtime = 'nodejs'
export const maxDuration = 300

const MAX_THUMBS = 120
const BUCKET = 'reports'

/** now から「前日 JST 00:00〜当日 JST 00:00」を UTC ISO で返す。 */
function prevJstDay(now: Date): { fromISO: string; toISO: string } {
  const jstMs = now.getTime() + 9 * 60 * 60 * 1000
  const j = new Date(jstMs)
  // 当日 JST 00:00 を UTC で（JST midnight = UTC of that wall-clock − 9h）
  const todayJstMidnightUtc = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate(), 0, 0, 0) - 9 * 60 * 60 * 1000
  const toISO = new Date(todayJstMidnightUtc).toISOString()
  const fromISO = new Date(todayJstMidnightUtc - 24 * 60 * 60 * 1000).toISOString()
  return { fromISO, toISO }
}

interface FindingRow {
  id: string
  run_id: string
  camera_id: string
  status: string
  recorder_cameras: { name: string } | null
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const authed = req.headers.get('authorization') === `Bearer ${secret}`
    || req.headers.get('x-cron-secret') === secret
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const now = new Date()
  const { fromISO, toISO } = prevJstDay(now)
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const supa = createSupabaseService()

  const { data: settings, error } = await supa
    .from('security_settings')
    .select('store_id, notify_emails, stores ( name )')
    .eq('enabled', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let generated = 0, skippedNoRuns = 0, skippedExists = 0, mailed = 0
  const details: Array<{ store_id: string; result: string }> = []

  for (const s of (settings ?? []) as unknown as Array<{ store_id: string | null; notify_emails: string[] | null; stores: { name: string } | null }>) {
    const storeId = s.store_id
    if (!storeId) continue

    // 冪等: 同一店舗・同一 period_from の行が既にあればスキップ
    const { data: existing } = await supa
      .from('security_reports')
      .select('id')
      .eq('store_id', storeId)
      .eq('period_from', fromISO)
      .maybeSingle()
    if (existing) { skippedExists++; details.push({ store_id: storeId, result: 'exists' }); continue }

    // 前日の巡回
    const { data: runRows } = await supa
      .from('patrol_runs')
      .select('id, started_at, trigger, status')
      .eq('store_id', storeId)
      .gte('started_at', fromISO)
      .lt('started_at', toISO)
      .order('started_at', { ascending: true })
    const runs = (runRows ?? []) as ReportRun[]
    if (!runs.length) { skippedNoRuns++; details.push({ store_id: storeId, result: 'no_runs' }); continue }

    const runIds = runs.map((r) => r.id)
    const { data: fRows } = await supa
      .from('patrol_findings')
      .select('id, run_id, camera_id, status, recorder_cameras ( name )')
      .in('run_id', runIds)
      .order('created_at', { ascending: true })
    const fr = (fRows ?? []) as unknown as FindingRow[]
    const findings: ReportFinding[] = fr.map((f) => ({
      id: f.id, run_id: f.run_id, cameraName: f.recorder_cameras?.name ?? '—', status: f.status,
    }))

    // スナップショット取得（storage から直接 download。jpg→png フォールバック）。上限で打切り。
    const images = new Map<string, Buffer | null>()
    let downloaded = 0
    for (const f of fr) {
      if (downloaded >= MAX_THUMBS) { images.set(f.id, null); continue }
      let buf: Buffer | null = null
      for (const ext of ['jpg', 'png']) {
        const { data: blob } = await supa.storage.from('security-snapshots').download(`${f.run_id}/${f.camera_id}.${ext}`)
        if (blob) { buf = Buffer.from(await blob.arrayBuffer()); break }
      }
      if (buf) downloaded++
      images.set(f.id, buf)
    }

    const storeName = s.stores?.name ?? '—'
    const notify = (s.notify_emails ?? []).filter(Boolean)

    // 1. 行起票（pdf_url は後で更新）
    const { data: report, error: repErr } = await supa
      .from('security_reports')
      .insert({ store_id: storeId, period_from: fromISO, period_to: toISO, generated_at: now.toISOString(), sent_to_emails: notify })
      .select('id')
      .maybeSingle()
    if (repErr || !report) { details.push({ store_id: storeId, result: 'insert_failed' }); continue }

    // 2. PDF 生成 + アップロード
    let pdf: Buffer
    try {
      pdf = await buildPatrolReportPdf({
        storeName, periodFrom: fromISO, periodTo: toISO, generatedAt: now.toISOString(),
        sentTo: notify, runs, findings, images,
      })
    } catch (e) {
      details.push({ store_id: storeId, result: `pdf_failed: ${(e as Error).message}` })
      continue
    }
    const key = `security/${report.id}.pdf`
    await supa.storage.from(BUCKET).upload(key, pdf, { contentType: 'application/pdf', upsert: true })
    const pdfUrl = `${supaUrl}/storage/v1/object/public/${BUCKET}/${key}`
    await supa.from('security_reports').update({ pdf_url: pdfUrl }).eq('id', report.id)
    generated++

    // 3. メール（notify_emails があれば PDF 添付）
    if (notify.length) {
      const dateLabel = new Date(fromISO).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
      const html = `<p>${storeName} の巡回レポート（${dateLabel}）です。</p>`
        + `<p>巡回 ${runs.length} 回・撮影 ${findings.length} 枚。詳細は添付 PDF、またはダッシュボードをご確認ください。</p>`
        + `<p><a href="${pdfUrl}">レポート PDF を開く</a></p>`
      const res = await sendEmail(notify, `【巡回レポート】${storeName} ${dateLabel}`, html, [{ filename: `patrol-${dateLabel}.pdf`, content: pdf }], SECURITY_FROM_ADDRESS)
      if (res.ok) mailed++
    }
    details.push({ store_id: storeId, result: 'generated' })
  }

  return NextResponse.json({ ok: true, period: { fromISO, toISO }, generated, mailed, skippedNoRuns, skippedExists, details })
}
