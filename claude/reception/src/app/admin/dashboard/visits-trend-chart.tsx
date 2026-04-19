'use client'

import { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { useLocale } from '@/lib/i18n/useLocale'

type Period = 'day' | 'week' | 'month'

interface RawPoint {
  date: string
  visit_count: number
  store_id: string
}

interface Store {
  id: string
  name: string
}

// 店舗ごとの色（最大5店舗対応）
const STORE_COLORS = ['#1e3a5f', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']

export function VisitsTrendChart() {
  const { locale } = useLocale()
  const [period, setPeriod] = useState<Period>('day')
  const [selectedStore, setSelectedStore] = useState<string>('all') // 'all' or store.id
  const [stores, setStores] = useState<Store[]>([])
  const [rawData, setRawData] = useState<RawPoint[]>([])
  const [loading, setLoading] = useState(true)

  // 店舗一覧を取得
  useEffect(() => {
    fetch('/api/v1/admin/stores')
      .then(r => r.ok ? r.json() : { stores: [] })
      .then(d => setStores(d.stores ?? []))
      .catch(() => {})
  }, [])

  // トレンドデータを全店舗分まとめて取得
  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ period })
    fetch(`/api/v1/admin/analytics/visits-trend?${params}`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => setRawData(d.data ?? []))
      .catch(() => setRawData([]))
      .finally(() => setLoading(false))
  }, [period])

  // rawData をグラフ用に整形（選択店舗に応じてフィルタ）
  const chartData = buildChartData(rawData, stores, selectedStore, period, locale)

  const periodLabels: Record<Period, string> = { day: '日次', week: '週次', month: '月次' }

  // 表示する線の定義
  const lines: { storeId: string; name: string; color: string }[] =
    selectedStore === 'all'
      ? stores.map((s, i) => ({
          storeId: s.id,
          name: s.name,
          color: STORE_COLORS[i % STORE_COLORS.length],
        }))
      : [{
          storeId: selectedStore,
          name: stores.find(s => s.id === selectedStore)?.name ?? '',
          color: STORE_COLORS[stores.findIndex(s => s.id === selectedStore) % STORE_COLORS.length],
        }]

  return (
    <div className="bg-white rounded-2xl shadow-sm p-6 mb-6">
      {/* ヘッダー行 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h2 className="text-lg font-bold text-[#1e3a5f]">来訪推移</h2>
        {/* 期間セレクター */}
        <div className="flex rounded-lg border border-gray-200 overflow-hidden">
          {(['day', 'week', 'month'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm transition-colors ${
                period === p ? 'bg-[#1e3a5f] text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {periodLabels[p]}
            </button>
          ))}
        </div>
      </div>

      {/* 店舗タブ（ピル形式） */}
      {stores.length > 0 && (
        <div className="flex gap-2 mb-5 flex-wrap">
          <button
            onClick={() => setSelectedStore('all')}
            className={`px-4 py-1 rounded-full text-sm font-medium transition-colors ${
              selectedStore === 'all'
                ? 'bg-[#1e3a5f] text-white'
                : 'bg-[#f0f2f5] text-gray-600 hover:bg-gray-200'
            }`}
          >
            全店舗
          </button>
          {stores.map((s, i) => {
            const color = STORE_COLORS[i % STORE_COLORS.length]
            const active = selectedStore === s.id
            return (
              <button
                key={s.id}
                onClick={() => setSelectedStore(s.id)}
                className="px-4 py-1 rounded-full text-sm font-medium transition-colors"
                style={{
                  backgroundColor: active ? color : '#f0f2f5',
                  color: active ? '#fff' : '#4b5563',
                }}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1.5"
                  style={{ backgroundColor: active ? '#fff' : color }}
                />
                {s.name}
              </button>
            )
          })}
        </div>
      )}

      {/* グラフ本体 */}
      {loading ? (
        <div className="h-64 space-y-3">
          <div className="h-4 bg-gray-100 rounded animate-pulse w-1/2" />
          <div className="h-56 bg-gray-100 rounded animate-pulse" />
        </div>
      ) : chartData.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
          データがありません
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 5, right: 16, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              formatter={(value) => [`${value ?? 0}件`]}
            />
            {lines.length > 1 && (
              <Legend
                wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                formatter={(value) => <span style={{ color: '#374151' }}>{value}</span>}
              />
            )}
            {lines.map(l => (
              <Line
                key={l.storeId}
                type="monotone"
                dataKey={l.storeId}
                name={l.name}
                stroke={l.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function buildChartData(
  raw: RawPoint[],
  stores: Store[],
  selectedStore: string,
  period: Period,
  locale: string,
): Record<string, string | number>[] {
  const storeIds = selectedStore === 'all' ? stores.map(s => s.id) : [selectedStore]

  // date → storeId → count
  const map = new Map<string, Map<string, number>>()
  for (const p of raw) {
    if (!storeIds.includes(p.store_id)) continue
    if (!map.has(p.date)) map.set(p.date, new Map())
    map.get(p.date)!.set(p.store_id, (map.get(p.date)!.get(p.store_id) ?? 0) + p.visit_count)
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => {
      const row: Record<string, string | number> = { date: formatDate(date, period, locale) }
      for (const sid of storeIds) row[sid] = counts.get(sid) ?? 0
      return row
    })
}

function formatDate(dateStr: string, period: Period, locale: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const loc = locale === 'ja' ? 'ja-JP' : locale === 'zh' ? 'zh-CN' : locale === 'ko' ? 'ko-KR' : 'en-US'
  if (period === 'month') return d.toLocaleDateString(loc, { year: '2-digit', month: 'short' })
  return d.toLocaleDateString(loc, { month: 'numeric', day: 'numeric' })
}
