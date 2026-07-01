/**
 * 警備 巡回レポート PDF ビルダー（Phase A / A4）。
 *
 * 日次ロールアップ: 1店舗・1日分の巡回サイクルをまとめる。
 *   - 概要（店舗 / 期間 / 生成時刻 / 送信先）
 *   - 巡回サマリ（実行回数・完了・撮影枚数・要確認）
 *   - 巡回履歴表（サイクル毎: 時刻 / トリガー / 状態 / 枚数）
 *   - 証跡コンタクトシート（全スナップのサムネ格子・カメラ名と時刻ラベル）
 *
 * 純関数寄り: DB / Storage IO は呼び出し側（cron）で行い、ここは画像バッファを受け取って
 * PDF Buffer を返すだけ。フォントは同梱 OTF（Noto Sans JP）を process.cwd() から読む。
 */
import PDFDocument from 'pdfkit'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'

const FONT_PATH = join(process.cwd(), 'fonts', 'NotoSansJP-Regular.otf')
const MAX_THUMBS = 120 // コンタクトシートの上限（PDF肥大とメモリの保険）

export interface ReportRun {
  id: string
  started_at: string
  trigger: string
  status: string
}
export interface ReportFinding {
  id: string
  run_id: string
  cameraName: string
  status: string
}
export interface PatrolReportInput {
  storeName: string
  periodFrom: string
  periodTo: string
  generatedAt: string
  sentTo: string[]
  runs: ReportRun[]
  findings: ReportFinding[]
  /** findingId → JPEG/PNG バッファ（取得失敗は null）。 */
  images: Map<string, Buffer | null>
}

interface FindingRow {
  id: string
  run_id: string
  camera_id: string
  status: string
  recorder_cameras: { name: string } | null
}

/**
 * 巡回 run 群の findings を取得し、スナップショットを Storage から download して
 * レポート PDF を生成する（日次 cron と 単一サイクルの手動PDFで共有）。
 * 返り値に撮影枚数を含める（cron のメール本文で使う）。
 */
export async function renderReportForRuns(
  service: SupabaseClient,
  input: { storeName: string; runs: ReportRun[]; periodFrom: string; periodTo: string; sentTo: string[]; generatedAt: string },
): Promise<{ pdf: Buffer; findingCount: number }> {
  const runIds = input.runs.map((r) => r.id)
  let findings: ReportFinding[] = []
  const images = new Map<string, Buffer | null>()

  if (runIds.length) {
    const { data: fRows } = await service
      .from('patrol_findings')
      .select('id, run_id, camera_id, status, recorder_cameras ( name )')
      .in('run_id', runIds)
      .order('created_at', { ascending: true })
    const fr = (fRows ?? []) as unknown as FindingRow[]
    findings = fr.map((f) => ({ id: f.id, run_id: f.run_id, cameraName: f.recorder_cameras?.name ?? '—', status: f.status }))

    let downloaded = 0
    for (const f of fr) {
      if (downloaded >= MAX_THUMBS) { images.set(f.id, null); continue }
      let buf: Buffer | null = null
      for (const ext of ['jpg', 'png']) {
        const { data: blob } = await service.storage.from('security-snapshots').download(`${f.run_id}/${f.camera_id}.${ext}`)
        if (blob) { buf = Buffer.from(await blob.arrayBuffer()); break }
      }
      if (buf) downloaded++
      images.set(f.id, buf)
    }
  }

  const pdf = await buildPatrolReportPdf({
    storeName: input.storeName, periodFrom: input.periodFrom, periodTo: input.periodTo,
    generatedAt: input.generatedAt, sentTo: input.sentTo, runs: input.runs, findings, images,
  })
  return { pdf, findingCount: findings.length }
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
const fmtDateTime = (iso: string) =>
  iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })

const TRIGGER_LABEL: Record<string, string> = { scheduled: '定時', manual: '手動', emergency: '緊急' }

export function buildPatrolReportPdf(input: PatrolReportInput): Promise<Buffer> {
  const { storeName, periodFrom, periodTo, generatedAt, sentTo, runs, findings, images } = input

  const runById = new Map(runs.map((r) => [r.id, r]))
  const findingsByRun = new Map<string, ReportFinding[]>()
  for (const f of findings) {
    const arr = findingsByRun.get(f.run_id)
    if (arr) arr.push(f); else findingsByRun.set(f.run_id, [f])
  }
  const doneRuns = runs.filter((r) => r.status === 'done').length
  const flagged = findings.filter((f) => f.status === 'anomaly' || f.status === 'review' || f.status === 'confirmed').length

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    // font:'' で pdfkit の既定 Helvetica 読込を抑止（serverless で Helvetica.afm が
    // 無く ENOENT になるため）。直後に埋め込み日本語フォントを登録して既定にする。
    const doc = new PDFDocument({ size: 'A4', margin: 42, font: '' })
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.registerFont('jp', readFileSync(FONT_PATH)).font('jp')

    // ── header
    doc.fontSize(8).fillColor('#64748b').text('Recorder Monitor', 42, 38)
    doc.fontSize(20).fillColor('#0f172a').text('巡回レポート', 42, 56)
    doc.fontSize(11).fillColor('#475569').text(`${storeName} / ${fmtDate(periodFrom)}`, 42, 86)
    doc.moveTo(42, 110).lineTo(553, 110).strokeColor('#cbd5e1').lineWidth(0.8).stroke()
    doc.y = 124

    const heading = (label: string) => {
      doc.moveDown(0.5)
      doc.fillColor('#0f172a').fontSize(12).text(label, 42, doc.y, { paragraphGap: 4 })
      doc.moveTo(42, doc.y).lineTo(553, doc.y).strokeColor('#e2e8f0').lineWidth(0.5).stroke()
      doc.moveDown(0.4)
    }
    const kv = (label: string, value: string) => {
      const y = doc.y
      doc.fillColor('#64748b').fontSize(9).text(label, 42, y, { width: 130 })
      doc.fillColor('#0f172a').fontSize(10).text(value ?? '—', 174, y, { width: 379 })
      doc.moveDown(0.2)
    }

    heading('概要')
    kv('店舗名', storeName)
    kv('対象期間', `${fmtDate(periodFrom)} 〜 ${fmtDate(periodTo)}`)
    kv('生成時刻', fmtDateTime(generatedAt))
    kv('送信先メール', sentTo.join(', ') || '—')

    heading('巡回サマリ')
    kv('実行回数', `${runs.length} 回 (完了: ${doneRuns} 回)`)
    kv('撮影枚数 合計', String(findings.length))
    kv('要確認 (手動フラグ / 異常)', String(flagged))

    heading('巡回履歴')
    const recent = runs.slice().sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    if (recent.length === 0) {
      doc.fontSize(9).fillColor('#94a3b8').text('期間内に巡回履歴はありません。', 42, doc.y)
    } else {
      const cols = [120, 110, 110, 71]
      const startX = 42
      let y = doc.y + 4
      doc.fontSize(9).fillColor('#475569')
      ;['開始時刻', 'トリガー', '状態', '撮影枚数'].forEach((h, i) => {
        doc.text(h, startX + cols.slice(0, i).reduce((s, w) => s + w, 0) + 4, y + 4, { width: cols[i] - 8 })
      })
      y += 22
      doc.moveTo(startX, y - 2).lineTo(startX + cols.reduce((s, w) => s + w, 0), y - 2).strokeColor('#cbd5e1').lineWidth(0.5).stroke()
      doc.fontSize(9).fillColor('#0f172a')
      for (const r of recent) {
        if (y > 740) { doc.addPage(); y = 60 }
        const fcount = (findingsByRun.get(r.id) ?? []).length
        const cells = [fmtDateTime(r.started_at), TRIGGER_LABEL[r.trigger] ?? r.trigger, r.status, String(fcount)]
        cells.forEach((c, i) => {
          doc.text(c, startX + cols.slice(0, i).reduce((s, w) => s + w, 0) + 4, y + 4, { width: cols[i] - 8 })
        })
        y += 22
        doc.moveTo(startX, y - 2).lineTo(startX + cols.reduce((s, w) => s + w, 0), y - 2).strokeColor('#e2e8f0').lineWidth(0.3).stroke()
      }
      doc.y = y + 8
    }

    // ── 証跡コンタクトシート
    doc.addPage()
    doc.fillColor('#0f172a').fontSize(14).text('証跡（スナップショット）', 42, 48)
    doc.fontSize(9).fillColor('#64748b').text(`${storeName} / ${fmtDate(periodFrom)}`, 42, 70)
    doc.moveTo(42, 88).lineTo(553, 88).strokeColor('#cbd5e1').lineWidth(0.8).stroke()

    const withImg = findings.filter((f) => images.get(f.id))
    if (withImg.length === 0) {
      doc.fontSize(9).fillColor('#94a3b8').text('この期間に取得できたスナップショットはありません。', 42, 104)
    } else {
      const pageWidth = 595 - 42 * 2
      const cols = 4
      const gap = 6
      const cellW = (pageWidth - (cols - 1) * gap) / cols
      const cellH = cellW * 0.66 // 3:2
      const labelH = 22
      let x = 42, y = 104, col = 0

      for (const f of withImg.slice(0, MAX_THUMBS)) {
        if (y + cellH + labelH > 800) { doc.addPage(); x = 42; y = 48; col = 0 }
        const buf = images.get(f.id)
        try {
          if (buf) doc.image(buf, x, y, { width: cellW, height: cellH, fit: [cellW, cellH], align: 'center', valign: 'center' })
          else throw new Error('no image')
        } catch {
          doc.rect(x, y, cellW, cellH).fillAndStroke('#f1f5f9', '#cbd5e1')
        }
        const run = runById.get(f.run_id)
        const label = `${f.cameraName} ${run ? fmtTime(run.started_at) : ''}`
        doc.fontSize(7).fillColor('#475569').text(label, x, y + cellH + 2, { width: cellW, align: 'center' })
        col++
        if (col >= cols) { col = 0; x = 42; y += cellH + labelH } else { x += cellW + gap }
      }
      if (withImg.length > MAX_THUMBS) {
        doc.moveDown(1).fontSize(8).fillColor('#94a3b8').text(`※ 表示は先頭 ${MAX_THUMBS} 枚。全 ${withImg.length} 枚はギャラリーで確認できます。`, 42, doc.y)
      }
    }

    // ── footer（最終ページ）
    doc.fontSize(8).fillColor('#94a3b8').text(
      `生成: ${fmtDateTime(generatedAt)}  /  Recorder Monitor`,
      42, doc.page.height - 32, { width: 511, align: 'center' },
    )

    doc.end()
  })
}
