/**
 * BCP / SECURITY レポートの placeholder URL を 実 PDF に差し替える。
 *
 * 既存 bcp_reports / security_reports の pdf_url が https://example.com/ で
 * 始まる行を対象に、対応する patrol/event データを集計した PDF を生成して
 * Storage バケット "reports" にアップロード、行の pdf_url を実 URL に更新する。
 *
 * フォント: fonts/NotoSansJP-Regular.otf (Noto Sans JP, OFL ライセンス)
 *
 * 使い方:
 *   cd claude/monitor && node --env-file=.env.local scripts/generate-report-pdfs.mjs
 */
import { createClient } from '@supabase/supabase-js'
import PDFDocument from 'pdfkit'
import fs from 'node:fs'
import { Buffer } from 'node:buffer'

const FONT_PATH = 'fonts/NotoSansJP-Regular.otf'
const BUCKET    = 'reports'
const STORAGE_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}`

const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

// ── PDF utility ──────────────────────────────────────────────────────────────
function renderPdf(build) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const doc = new PDFDocument({ size: 'A4', margin: 42 })
    doc.on('data', (c) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.registerFont('jp', FONT_PATH).font('jp')
    build(doc)
    doc.end()
  })
}

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  })
const fmtDateTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString('ja-JP', {
        timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      })
    : '—'

// 共通ヘッダ/フッタ
function header(doc, title, subtitle) {
  doc.fontSize(8).fillColor('#64748b').text('Recorder Monitor', 42, 38)
  doc.fontSize(20).fillColor('#0f172a').text(title, 42, 56)
  if (subtitle) doc.fontSize(11).fillColor('#475569').text(subtitle, 42, 86)
  doc.moveTo(42, 110).lineTo(553, 110).strokeColor('#cbd5e1').lineWidth(0.8).stroke()
  doc.y = 124
}
function footer(doc) {
  const y = doc.page.height - 32
  doc.fontSize(8).fillColor('#94a3b8').text(
    `生成: ${fmtDateTime(new Date().toISOString())}  /  Recorder Monitor`,
    42, y, { width: 511, align: 'center' },
  )
}

// セクション見出し
function sectionHeading(doc, label) {
  doc.moveDown(0.5)
  doc.fillColor('#0f172a').fontSize(12).text(label, 42, doc.y, { paragraphGap: 4 })
  doc.moveTo(42, doc.y).lineTo(553, doc.y).strokeColor('#e2e8f0').lineWidth(0.5).stroke()
  doc.moveDown(0.4)
}

// 1行のラベル + 値
function kv(doc, label, value) {
  const y = doc.y
  doc.fillColor('#64748b').fontSize(9).text(label, 42, y, { width: 130, continued: false })
  doc.fillColor('#0f172a').fontSize(10).text(value ?? '—', 174, y, { width: 379 })
  doc.moveDown(0.2)
}

// 表（自前で行を引く）
function table(doc, headers, rows, colWidths) {
  const startX = 42
  let y = doc.y + 4
  // header
  doc.fontSize(9).fillColor('#475569').font('jp')
  let x = startX
  headers.forEach((h, i) => {
    doc.text(h, x + 4, y + 4, { width: colWidths[i] - 8 })
    x += colWidths[i]
  })
  doc.moveTo(startX, y).lineTo(startX + colWidths.reduce((s, w) => s + w, 0), y)
    .strokeColor('#cbd5e1').lineWidth(0.5).stroke()
  y += 22
  doc.moveTo(startX, y - 2).lineTo(startX + colWidths.reduce((s, w) => s + w, 0), y - 2)
    .strokeColor('#cbd5e1').stroke()
  // rows
  doc.fontSize(9).fillColor('#0f172a')
  for (const row of rows) {
    x = startX
    row.forEach((cell, i) => {
      doc.text(String(cell ?? '—'), x + 4, y + 4, { width: colWidths[i] - 8 })
      x += colWidths[i]
    })
    y += 22
    doc.moveTo(startX, y - 2).lineTo(startX + colWidths.reduce((s, w) => s + w, 0), y - 2)
      .strokeColor('#e2e8f0').lineWidth(0.3).stroke()
  }
  doc.y = y + 8
}

// ── PDF: SECURITY 巡回レポート ───────────────────────────────────────────────
async function buildSecurityPdf(report, storeName, runs, findingsByRun) {
  const periodRuns = runs.filter((r) => {
    if (r.store_id !== report.store_id) return false
    const t = new Date(r.started_at).getTime()
    return t >= new Date(report.period_from).getTime() && t <= new Date(report.period_to).getTime()
  })
  const doneRuns = periodRuns.filter((r) => r.status === 'done').length
  let anomaly = 0, review = 0, normal = 0, fp = 0, totalFindings = 0
  for (const r of periodRuns) {
    const fs = findingsByRun.get(r.id) ?? []
    totalFindings += fs.length
    for (const f of fs) {
      if (f.status === 'anomaly' || f.status === 'confirmed') anomaly++
      else if (f.status === 'review') review++
      else if (f.status === 'false_positive') fp++
      else if (f.status === 'normal') normal++
    }
  }

  return renderPdf((doc) => {
    header(doc, '巡回レポート', `${storeName} / ${fmtDate(report.period_from)} 〜 ${fmtDate(report.period_to)}`)

    sectionHeading(doc, '概要')
    kv(doc, '店舗名',         storeName)
    kv(doc, '対象期間',       `${fmtDate(report.period_from)} 〜 ${fmtDate(report.period_to)}`)
    kv(doc, '生成時刻',       fmtDateTime(report.generated_at))
    kv(doc, '送信先メール',   (report.sent_to_emails ?? []).join(', ') || '—')

    sectionHeading(doc, '巡回サマリ')
    kv(doc, '実行回数',       `${periodRuns.length} 回 (完了: ${doneRuns} 回)`)
    kv(doc, '検出件数 合計',  String(totalFindings))
    kv(doc, '  異常 (anomaly + confirmed)', String(anomaly))
    kv(doc, '  要確認 (review)',            String(review))
    kv(doc, '  正常 (normal)',              String(normal))
    kv(doc, '  誤検知 (false_positive)',    String(fp))

    sectionHeading(doc, '巡回履歴（最新10件）')
    const recent = periodRuns
      .slice()
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
      .slice(0, 10)
    if (recent.length === 0) {
      doc.fontSize(9).fillColor('#94a3b8').text('期間内に巡回履歴はありません。', 42, doc.y)
    } else {
      table(
        doc,
        ['開始時刻', 'トリガー', 'ステータス', '検出件数'],
        recent.map((r) => {
          const fcount = (findingsByRun.get(r.id) ?? []).length
          return [fmtDateTime(r.started_at), r.trigger, r.status, fcount]
        }),
        [120, 110, 110, 71],
      )
    }

    footer(doc)
  })
}

// F40: offset_min → 表示ラベル
function offsetLabel(min) {
  if (min == null)  return '—'
  if (min === 0)    return '発生時'
  if (min < 0)      return `${Math.abs(min)}分前`
  return `${min}分後`
}

// ── PDF: BCP イベントレポート (F40: 8枚 JPEG スナップショット タイムライン) ──
async function buildBcpPdf(report, event, storeName, clips) {
  // Group clips by camera, separating new-style snapshots (offset_min != null)
  // from legacy MP4 clips (offset_min IS NULL).
  const byCamera = new Map()
  for (const c of clips) {
    const camId = c.camera_id ?? '—'
    let g = byCamera.get(camId)
    if (!g) { g = { snapshots: [], legacy: [] }; byCamera.set(camId, g) }
    if (c.offset_min == null) g.legacy.push(c)
    else                       g.snapshots.push(c)
  }
  // Within each camera, sort snapshots by offset_min ascending so the
  // table reads left → right as a chronological timeline.
  for (const g of byCamera.values()) {
    g.snapshots.sort((a, b) => (a.offset_min ?? 0) - (b.offset_min ?? 0))
  }

  // Fetch thumbnail JPEGs so the PDF embeds visible images.
  // Best-effort: failures fall back to a placeholder cell.
  const thumbBufs = new Map()  // clip.id → Buffer | null
  await Promise.all(clips.map(async (c) => {
    const url = c.thumbnail_url || c.clip_url
    if (!url) { thumbBufs.set(c.id, null); return }
    try {
      const r = await fetch(url)
      if (!r.ok) { thumbBufs.set(c.id, null); return }
      thumbBufs.set(c.id, Buffer.from(await r.arrayBuffer()))
    } catch { thumbBufs.set(c.id, null) }
  }))

  return renderPdf((doc) => {
    const subtitle = event
      ? `${storeName} / ${event.alert_type}${event.is_test ? ' (テスト)' : ''} / ${fmtDateTime(event.alert_issued_at)}`
      : storeName
    header(doc, 'BCP インシデント レポート', subtitle)

    sectionHeading(doc, 'イベント概要')
    kv(doc, '店舗名',       storeName)
    kv(doc, 'アラート種別', event?.alert_type ?? '—')
    kv(doc, 'アラート源',   event?.alert_source ?? '—')
    kv(doc, '発令時刻',     fmtDateTime(event?.alert_issued_at))
    kv(doc, 'エリアコード', event?.area_code ?? '—')
    kv(doc, 'ステータス',   event?.status ?? '—')
    kv(doc, 'テスト発令',   event?.is_test ? 'はい' : 'いいえ')

    sectionHeading(doc, 'レポート')
    kv(doc, '生成時刻',     fmtDateTime(report.generated_at))
    kv(doc, '送信先メール', (report.sent_to_emails ?? []).join(', ') || '—')

    sectionHeading(doc, 'スナップショット タイムライン (8 枚 × カメラ毎)')
    if (clips.length === 0) {
      doc.fontSize(9).fillColor('#94a3b8').text(
        '対象カメラが配備されていない、またはテスト発令のため映像記録はありません。',
        42, doc.y,
      )
    } else {
      // For each camera, render an 8-thumbnail grid (4 columns × 2 rows).
      const pageWidth = 595 - 42 * 2       // A4 width minus margins
      const cols = 4
      const cellW = (pageWidth - (cols - 1) * 6) / cols   // 6px gap
      const cellH = cellW * 0.75            // 4:3 aspect ratio for camera frames

      for (const [camId, g] of byCamera.entries()) {
        if (doc.y > 720) doc.addPage()
        doc.fontSize(10).fillColor('#1e293b')
          .text(`カメラ ${camId.slice(0, 8)} (${g.snapshots.length}/8)`, 42, doc.y)
        doc.y += 4

        let x = 42, y = doc.y
        g.snapshots.forEach((c, i) => {
          // Wrap to next row after every `cols` thumbnails.
          if (i > 0 && i % cols === 0) {
            x = 42
            y += cellH + 18
          }

          // Image
          const buf = thumbBufs.get(c.id)
          if (buf) {
            try { doc.image(buf, x, y, { width: cellW, height: cellH, fit: [cellW, cellH] }) }
            catch { doc.rect(x, y, cellW, cellH).fillAndStroke('#f1f5f9', '#cbd5e1') }
          } else {
            doc.rect(x, y, cellW, cellH).fillAndStroke('#f1f5f9', '#cbd5e1')
            doc.fillColor('#94a3b8').fontSize(8)
              .text('—', x, y + cellH / 2 - 4, { width: cellW, align: 'center' })
          }

          // Label below the cell
          doc.fontSize(7).fillColor(c.offset_min === 0 ? '#dc2626' : '#475569')
            .text(offsetLabel(c.offset_min), x, y + cellH + 2, { width: cellW, align: 'center' })

          x += cellW + 6
        })

        // Advance Y to below the last row of this camera.
        const rows = Math.ceil(g.snapshots.length / cols)
        doc.y = y + rows * (cellH + 18)
        doc.moveDown(0.4)

        // Legacy MP4 clips, if any
        if (g.legacy.length > 0) {
          doc.fontSize(8).fillColor('#94a3b8')
            .text(`(旧仕様 MP4 クリップ: ${g.legacy.length}件)`, 42, doc.y)
          doc.moveDown(0.4)
        }
      }
    }

    footer(doc)
  })
}

// ── アップロード + URL 更新 ──────────────────────────────────────────────────
async function uploadAndPatch({ table, id, buf, key }) {
  const { error: upErr } = await supa.storage.from(BUCKET).upload(key, buf, {
    contentType: 'application/pdf',
    upsert: true,
  })
  if (upErr) throw upErr
  const publicUrl = `${STORAGE_BASE}/${key}`
  const { error: updErr } = await supa.from(table).update({ pdf_url: publicUrl }).eq('id', id)
  if (updErr) throw updErr
  return publicUrl
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(FONT_PATH)) {
    console.error(`Font not found at ${FONT_PATH} — run the download step first`)
    process.exit(1)
  }

  // すべての参照データを最初にまとめて取る
  const [
    bcpReports, bcpEvents, bcpClips,
    secReports, runs, findings, stores,
  ] = await Promise.all([
    supa.from('bcp_reports').select('id, event_id, pdf_url, generated_at, sent_to_emails').like('pdf_url', 'https://example.com/%'),
    supa.from('bcp_events').select('id, store_id, alert_source, alert_type, alert_issued_at, area_code, status, is_test'),
    supa.from('bcp_clips').select('id, event_id, camera_id, offset_min, clip_from, clip_to, duration_sec, upload_status, clip_url, thumbnail_url'),
    supa.from('security_reports').select('id, store_id, period_from, period_to, pdf_url, generated_at, sent_to_emails').like('pdf_url', 'https://example.com/%'),
    supa.from('patrol_runs').select('id, store_id, started_at, trigger, status'),
    supa.from('patrol_findings').select('run_id, status'),
    supa.from('stores').select('id, name'),
  ]).then((arr) => arr.map((r) => r.data ?? []))

  const eventById = new Map(bcpEvents.map((e) => [e.id, e]))
  const clipsByEvent = new Map()
  for (const c of bcpClips) {
    const arr = clipsByEvent.get(c.event_id)
    if (arr) arr.push(c); else clipsByEvent.set(c.event_id, [c])
  }
  const findingsByRun = new Map()
  for (const f of findings) {
    const arr = findingsByRun.get(f.run_id)
    if (arr) arr.push(f); else findingsByRun.set(f.run_id, [f])
  }
  const storeName = new Map(stores.map((s) => [s.id, s.name]))

  console.log(`Targets — BCP: ${bcpReports.length}, SECURITY: ${secReports.length}`)

  let bcpOk = 0, secOk = 0
  for (const r of bcpReports) {
    const ev   = eventById.get(r.event_id)
    const name = ev?.store_id ? (storeName.get(ev.store_id) ?? '—') : '—'
    const clips = clipsByEvent.get(r.event_id) ?? []
    try {
      const buf = await buildBcpPdf(r, ev, name, clips)
      const url = await uploadAndPatch({ table: 'bcp_reports', id: r.id, buf, key: `bcp/${r.id}.pdf` })
      console.log(`  BCP   ${name.padEnd(10, ' ')} ${ev?.alert_type ?? '—'.padEnd(12, ' ')} → ${url}`)
      bcpOk++
    } catch (e) {
      console.warn(`  BCP   ${r.id.slice(0,8)} failed:`, e.message)
    }
  }
  for (const r of secReports) {
    const name = r.store_id ? (storeName.get(r.store_id) ?? '—') : '—'
    try {
      const buf = await buildSecurityPdf(r, name, runs, findingsByRun)
      const url = await uploadAndPatch({ table: 'security_reports', id: r.id, buf, key: `security/${r.id}.pdf` })
      console.log(`  SEC   ${name.padEnd(10, ' ')} ${fmtDate(r.period_from)} → ${url}`)
      secOk++
    } catch (e) {
      console.warn(`  SEC   ${r.id.slice(0,8)} failed:`, e.message)
    }
  }
  console.log(`\nDone — BCP: ${bcpOk}/${bcpReports.length}, SECURITY: ${secOk}/${secReports.length}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
