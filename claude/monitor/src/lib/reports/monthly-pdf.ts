/**
 * 月次利用状況レポート PDF ビルダー（C）。pdfkit ＋ 同梱 Noto Sans JP。
 * 純関数寄り: 集計済みスナップショットを受け取り PDF Buffer を返すだけ（IO は呼び出し側）。
 * フォントは巡回レポート(patrol-report.ts)と同じ同梱 OTF を process.cwd() から読む。
 */
import PDFDocument from 'pdfkit'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { confirmRatePct } from './usage'
import type { MonthlyTotals, MonthlyStoreRow, MonthlyContract, MonthlyRegistration } from './monthly-types'

const FONT_PATH = join(process.cwd(), 'fonts', 'NotoSansJP-Regular.otf')

export interface MonthlyPdfInput {
  tenantName: string
  ym: string             // 'YYYY-MM'
  generatedAt: string    // ISO
  totals: MonthlyTotals
  stores: MonthlyStoreRow[]
  contract: MonthlyContract | null
  reg: MonthlyRegistration | null
}

function fmtJst(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function ymLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `${y}年${Number(m)}月`
}
function n(v: number): string { return (v ?? 0).toLocaleString('ja-JP') }

export function buildMonthlyReportPdf(input: MonthlyPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  const font = readFileSync(FONT_PATH)
  doc.registerFont('jp', font)
  doc.font('jp')

  const left = doc.page.margins.left
  const right = doc.page.width - doc.page.margins.right
  const width = right - left

  // ── ヘッダ ──
  doc.fontSize(18).text('月次利用状況レポート', left, 44)
  doc.fontSize(11).fillColor('#444')
    .text(`${input.tenantName}　${ymLabel(input.ym)}`, { continued: false })
  doc.fontSize(9).fillColor('#888').text(`確定日時: ${fmtJst(input.generatedAt)}`)
  doc.moveDown(0.8).fillColor('#000')

  // ── 契約 vs 登録 ──
  if (input.contract && input.reg) {
    doc.fontSize(12).text('登録数（／契約数）')
    doc.moveDown(0.3).fontSize(10).fillColor('#333')
    const c = input.contract, r = input.reg
    const lim = (v: number | null) => (v == null ? '∞' : n(v))
    doc.text(`店舗数 ${n(r.stores)} / ${lim(c.max_stores)}　　巡回ON ${n(r.patrol)} / ${lim(c.max_patrol)}　　発報ON ${n(r.alarm)} / ${lim(c.max_alarm)}　　検査ON ${n(r.baggage)} / ${lim(c.max_baggage)}`)
    doc.moveDown(0.8).fillColor('#000')
  }

  // ── テナント全体の指標 ──
  const t = input.totals
  const rate = confirmRatePct(t.baggage_confirmed, t.baggage_exit)
  doc.fontSize(12).text('利用量（テナント全体）')
  doc.moveDown(0.3).fontSize(10).fillColor('#333')
  doc.text(`巡回数: ${n(t.patrol)}　　発報数: ${n(t.alarm)}　　手荷物検査数: ${n(t.inspection)}`)
  doc.text(`映像確認率: ${rate == null ? '—' : rate + '%'}（店長確認 ${n(t.baggage_confirmed)} / 退出検査 ${n(t.baggage_exit)}）`)
  doc.text(`顔認証: 試行 ${n(t.face_attempts)}（一致 ${n(t.face_matched)} / アンマッチ ${n(t.face_unmatched)}）`)
  doc.moveDown(0.8).fillColor('#000')

  // ── 店舗別テーブル ──
  doc.fontSize(12).text('店舗別')
  doc.moveDown(0.3)
  const cols = [
    { key: 'name',    label: '店舗',       w: 0.28, align: 'left'  as const },
    { key: 'patrol',  label: '巡回',       w: 0.10, align: 'right' as const },
    { key: 'alarm',   label: '発報',       w: 0.10, align: 'right' as const },
    { key: 'insp',    label: '検査',       w: 0.10, align: 'right' as const },
    { key: 'rate',    label: '映像確認率', w: 0.14, align: 'right' as const },
    { key: 'face',    label: '顔認証(試行)', w: 0.14, align: 'right' as const },
    { key: 'mu',      label: '一致/不一致', w: 0.14, align: 'right' as const },
  ]
  const xOf = (i: number) => left + cols.slice(0, i).reduce((a, c) => a + c.w * width, 0)
  const rowH = 16

  function header(y: number): number {
    doc.fontSize(8.5).fillColor('#555')
    cols.forEach((c, i) => doc.text(c.label, xOf(i), y, { width: c.w * width, align: c.align }))
    doc.moveTo(left, y + rowH - 3).lineTo(right, y + rowH - 3).strokeColor('#ccc').stroke()
    doc.fillColor('#000')
    return y + rowH
  }
  let y = header(doc.y + 2)

  for (const s of input.stores) {
    if (y > doc.page.height - doc.page.margins.bottom - rowH) {
      doc.addPage(); y = header(doc.page.margins.top)
    }
    const sr = confirmRatePct(s.baggage_confirmed, s.baggage_exit)
    const cells = [
      s.store_name, n(s.patrol), n(s.alarm), n(s.inspection),
      sr == null ? '—' : sr + '%', n(s.face_attempts), `${n(s.face_matched)}/${n(s.face_unmatched)}`,
    ]
    doc.fontSize(8.5)
    cells.forEach((v, i) => doc.text(v, xOf(i), y, { width: cols[i].w * width, align: cols[i].align }))
    y += rowH
  }
  if (!input.stores.length) {
    doc.fontSize(9).fillColor('#999').text('この月の利用データはありません。', left, y + 4)
  }

  doc.end()
  return done
}
