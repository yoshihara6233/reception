'use client'

/**
 * 巡回レポート一覧（列別フィルタ付き）。
 * サーバで算出済みの行を受け取り、各列のテキストフィルタで絞り込む。
 */
import { useState, useMemo } from 'react'
import { ReportImagesButton } from '../ReportImagesButton'

export interface ReportRowVM {
  id: string
  storeName: string
  kind: string            // 種別（定例 / 手動 / 定時 / 緊急 / 個別）
  dateLabel: string       // 対象日（日付のみ）
  generatedLabel: string  // 生成時刻
  runs: number
  done: number
  pdfUrl: string | null
  emails: string
  count: number           // 証跡枚数（画像ビューアの有効/無効）
}

type FilterKey = 'storeName' | 'kind' | 'dateLabel' | 'generatedLabel' | 'emails'

export function ReportsTable({ rows }: { rows: ReportRowVM[] }) {
  const [f, setF] = useState<Record<FilterKey, string>>({
    storeName: '', kind: '', dateLabel: '', generatedLabel: '', emails: '',
  })

  const filtered = useMemo(() => {
    const norm = (s: string) => s.toLowerCase()
    return rows.filter((r) =>
      (!f.storeName      || norm(r.storeName).includes(norm(f.storeName))) &&
      (!f.kind           || norm(r.kind).includes(norm(f.kind))) &&
      (!f.dateLabel      || norm(r.dateLabel).includes(norm(f.dateLabel))) &&
      (!f.generatedLabel || norm(r.generatedLabel).includes(norm(f.generatedLabel))) &&
      (!f.emails         || norm(r.emails).includes(norm(f.emails))),
    )
  }, [rows, f])

  const inputCls =
    'mt-1 w-full rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-normal ' +
    'text-slate-700 placeholder:text-slate-300 dark:border-gedline dark:bg-gedbg3 dark:text-gedink dark:placeholder:text-gedink3'

  const filterInput = (k: FilterKey) => (
    <input
      value={f[k]}
      onChange={(e) => setF((prev) => ({ ...prev, [k]: e.target.value }))}
      placeholder="絞り込み"
      className={inputCls}
    />
  )

  if (rows.length === 0) {
    return <p className="text-xs text-slate-500 dark:text-gedink3">まだレポートがありません。</p>
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-slate-500 dark:text-gedink3">
        {filtered.length} / {rows.length} 件
      </div>
      <div className="overflow-x-auto rounded border border-slate-200 dark:border-gedline">
        <table className="min-w-full divide-y divide-slate-200 text-xs dark:divide-gedline">
          <thead className="bg-slate-50 dark:bg-gedbg3">
            <tr className="text-left align-top text-[10px] uppercase tracking-wide text-slate-500 dark:text-gedink3">
              <th className="px-3 py-1.5">店舗{filterInput('storeName')}</th>
              <th className="px-3 py-1.5">種別{filterInput('kind')}</th>
              <th className="px-3 py-1.5">対象日{filterInput('dateLabel')}</th>
              <th className="px-3 py-1.5">生成時刻{filterInput('generatedLabel')}</th>
              <th className="px-3 py-1.5 text-center">巡回</th>
              <th className="px-3 py-1.5 text-center">完了</th>
              <th className="px-3 py-1.5">PDF</th>
              <th className="px-3 py-1.5">画像</th>
              <th className="px-3 py-1.5">送信先{filterInput('emails')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-gedline">
            {filtered.map((r) => (
              <tr key={r.id} className="text-slate-700 dark:text-gedink">
                <td className="px-3 py-1.5">{r.storeName}</td>
                <td className="px-3 py-1.5">
                  <span className="inline-block rounded bg-slate-100 px-1.5 py-px text-[11px] font-medium text-slate-600 dark:bg-gedbg3 dark:text-gedink2">{r.kind}</span>
                </td>
                <td className="px-3 py-1.5 font-mono tabular-nums">{r.dateLabel}</td>
                <td className="px-3 py-1.5 font-mono tabular-nums">{r.generatedLabel}</td>
                <td className="px-3 py-1.5 text-center font-mono tabular-nums">{r.runs}</td>
                <td className="px-3 py-1.5 text-center font-mono tabular-nums">{r.done}</td>
                <td className="px-3 py-1.5">
                  {r.pdfUrl ? (
                    <a href={r.pdfUrl} target="_blank" rel="noopener noreferrer"
                       className="text-blue-600 underline hover:text-blue-800 dark:text-gedaccent">開く</a>
                  ) : (
                    <span className="text-slate-400 dark:text-gedink3">未生成</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <ReportImagesButton reportId={r.id} count={r.count} />
                </td>
                <td className="max-w-xs truncate px-3 py-1.5 text-slate-500 dark:text-gedink3">
                  {r.emails || '—'}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400 dark:text-gedink3">条件に一致するレポートがありません</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
