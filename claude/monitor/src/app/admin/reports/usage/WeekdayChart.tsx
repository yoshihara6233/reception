'use client'

/**
 * 曜日別チャート。巡回/発報/検査を個別に表示ON/OFF切替できる（チップ）。
 * 表示中の系列だけを積み上げ、最大値も表示系列で再スケールする。
 */
import { useState } from 'react'

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const

export interface WeekdayRow {
  dow: number
  patrol_count: number | string
  alarm_count: number | string
  inspection_count: number | string
}

type Key = 'patrol' | 'alarm' | 'inspection'
const SERIES: { key: Key; label: string; color: string; chipOn: string }[] = [
  { key: 'patrol',     label: '巡回', color: 'bg-blue-500',    chipOn: 'bg-blue-500 text-white border-blue-500' },
  { key: 'alarm',      label: '発報', color: 'bg-red-500',     chipOn: 'bg-red-500 text-white border-red-500' },
  { key: 'inspection', label: '検査', color: 'bg-emerald-500', chipOn: 'bg-emerald-500 text-white border-emerald-500' },
]

const n = (v: number | string) => (typeof v === 'number' ? v : Number(v ?? 0))

export function WeekdayChart({ rows }: { rows: WeekdayRow[] }) {
  const [on, setOn] = useState<Record<Key, boolean>>({ patrol: true, alarm: true, inspection: true })
  const toggle = (k: Key) => setOn((s) => ({ ...s, [k]: !s[k] }))

  const by = new Map(rows.map((r) => [r.dow, r]))
  const days = [0, 1, 2, 3, 4, 5, 6].map((d) => {
    const r = by.get(d)
    return {
      dow: d,
      patrol: n(r?.patrol_count ?? 0),
      alarm: n(r?.alarm_count ?? 0),
      inspection: n(r?.inspection_count ?? 0),
    }
  })
  const shownTotal = (d: (typeof days)[number]) =>
    (on.patrol ? d.patrol : 0) + (on.alarm ? d.alarm : 0) + (on.inspection ? d.inspection : 0)
  const max = Math.max(1, ...days.map(shownTotal))

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap gap-2">
        {SERIES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => toggle(s.key)}
            aria-pressed={on[s.key]}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition ${
              on[s.key] ? s.chipOn : 'border-slate-200 bg-white text-slate-400'
            }`}
          >
            <i className={`inline-block h-2 w-2 rounded-sm ${on[s.key] ? 'bg-white/80' : s.color}`} />
            {s.label}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {days.map((d) => (
          <div key={d.dow} className="flex items-center gap-2 text-xs">
            <span className="w-5 text-slate-500">{WEEKDAY_JA[d.dow]}</span>
            <div className="flex h-4 flex-1 overflow-hidden rounded bg-slate-50">
              {on.patrol     && <div className="bg-blue-500"    style={{ width: `${(d.patrol / max) * 100}%` }} />}
              {on.alarm      && <div className="bg-red-500"     style={{ width: `${(d.alarm / max) * 100}%` }} />}
              {on.inspection && <div className="bg-emerald-500" style={{ width: `${(d.inspection / max) * 100}%` }} />}
            </div>
            <span className="w-16 text-right tabular-nums text-slate-500">{shownTotal(d).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
