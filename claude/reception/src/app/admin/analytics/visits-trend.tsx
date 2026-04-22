'use client'

import { useEffect, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'

type Period = 'day' | 'week' | 'month'

interface TrendRow {
  date: string
  visit_count: number
  store_id: string
}

interface Props {
  storeId?: string
}

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'day',   label: '日別（30日）' },
  { value: 'week',  label: '週別（12週）' },
  { value: 'month', label: '月別（12ヶ月）' },
]

function formatDateLabel(dateStr: string, period: Period): string {
  const d = new Date(dateStr)
  if (period === 'month') {
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  if (period === 'week') {
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}週`
  }
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

export function VisitsTrend({ storeId }: Props) {
  const [period, setPeriod] = useState<Period>('day')
  const [data, setData] = useState<{ date: string; label: string; count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [total, setTotal] = useState(0)
  const [peak, setPeak] = useState<{ label: string; count: number } | null>(null)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ period })
    if (storeId) params.set('storeId', storeId)

    fetch(`/api/v1/admin/analytics/visits-trend?${params}`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(json => {
        const rows: TrendRow[] = json.data ?? []
        // 同じ日付のカウントを合算（store_idが複数の場合）
        const grouped: Record<string, number> = {}
        for (const row of rows) {
          grouped[row.date] = (grouped[row.date] || 0) + row.visit_count
        }
        const formatted = Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, count]) => ({
            date,
            label: formatDateLabel(date, period),
            count,
          }))
        setData(formatted)

        const t = formatted.reduce((s, r) => s + r.count, 0)
        setTotal(t)
        const p = formatted.reduce((max, r) => r.count > (max?.count ?? 0) ? r : max, null as typeof formatted[0] | null)
        setPeak(p ? { label: p.label, count: p.count } : null)
      })
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [period, storeId])

  const avg = data.length > 0 ? Math.round(total / data.length * 10) / 10 : 0

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-base font-semibold text-[#1e3a5f]">来訪トレンド</h3>
          {!loading && data.length > 0 && (
            <p className="text-xs text-gray-400 mt-0.5">
              合計 {total.toLocaleString()} 件 · 平均 {avg} 件/{period === 'month' ? '月' : period === 'week' ? '週' : '日'}
              {peak && ` · ピーク ${peak.label}（${peak.count}件）`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                period === opt.value
                  ? 'bg-white text-[#1e3a5f] shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* グラフ */}
      {loading ? (
        <div className="h-56 bg-gray-50 rounded-xl animate-pulse" />
      ) : data.length === 0 ? (
        <div className="h-56 flex items-center justify-center text-gray-400 text-sm">
          データがありません
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              interval={period === 'day' ? 4 : 0}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 8, border: '1px solid #e5e7eb',
                fontSize: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              }}
              formatter={(value) => [`${value} 件`, '来訪数']}
              labelStyle={{ color: '#1e3a5f', fontWeight: 600 }}
            />
            <Bar
              dataKey="count"
              fill="#1e3a5f"
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
