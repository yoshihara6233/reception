'use client'

/**
 * 店舗別 利用量テーブル ＋ CSV 書出し（R5）。サーバから合計済みの店舗行を受け取る。
 * 映像確認率 = 店長確認済 / 退出検査（分母0は「—」）。
 */
import { confirmRatePct, type UsageMetrics } from '@/lib/reports/usage'

export interface StoreRow extends UsageMetrics { store_id: string; store_name: string }

const HEADERS = ['店舗', '巡回', '発報', '検査', '退出検査', '店長確認', '映像確認率', '顔認証(試行)', '一致', 'アンマッチ', 'ライブ/録画', '証跡確認']

function toCsv(rows: StoreRow[]): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [HEADERS.join(',')]
  for (const r of rows) {
    const rate = confirmRatePct(r.baggage_confirmed_count, r.baggage_exit_count)
    lines.push([
      r.store_name, r.patrol_count, r.alarm_count, r.inspection_count,
      r.baggage_exit_count, r.baggage_confirmed_count, rate == null ? '' : rate,
      r.face_auth_attempts, r.face_auth_matched, r.face_auth_unmatched,
      r.video_live_count, r.footage_access_count,
    ].map(esc).join(','))
  }
  return lines.join('\n')
}

export function UsageStoreTable({ rows, monthLabel }: { rows: StoreRow[]; monthLabel: string }) {
  function downloadCsv() {
    const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `usage-${monthLabel.replace(/[年月]/g, '-').replace(/-$/, '')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!rows.length) {
    return <p className="text-xs text-slate-400">この月の利用データはありません。</p>
  }

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button type="button" onClick={downloadCsv}
          className="rounded border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">
          CSV 書出し
        </button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">店舗</th>
              <th className="px-3 py-2 text-right">巡回</th>
              <th className="px-3 py-2 text-right">発報</th>
              <th className="px-3 py-2 text-right">検査</th>
              <th className="px-3 py-2 text-right">映像確認率</th>
              <th className="px-3 py-2 text-right">顔認証(試行)</th>
              <th className="px-3 py-2 text-right">一致/アンマッチ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const rate = confirmRatePct(r.baggage_confirmed_count, r.baggage_exit_count)
              return (
                <tr key={r.store_id} className="border-t border-slate-100">
                  <td className="px-3 py-1.5 font-medium text-slate-800">{r.store_name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.patrol_count.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.alarm_count.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.inspection_count.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" title={`${r.baggage_confirmed_count} / ${r.baggage_exit_count}`}>
                    {rate == null ? '—' : `${rate}%`}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.face_auth_attempts.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                    {r.face_auth_matched.toLocaleString()} / {r.face_auth_unmatched.toLocaleString()}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
