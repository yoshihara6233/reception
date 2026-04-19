'use client'

import { useEffect, useState } from 'react'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface PurposeData {
  name: string
  count: number
}

interface AnalyticsData {
  by_purpose: PurposeData[]
  heatmap: number[][]
  by_hour: { hour: number; count: number }[]
}

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']
const COLORS = [
  '#1e3a5f', '#2c4f7c', '#3d6ba0', '#5a8fc4', '#7ab0e0',
  '#9ecae1', '#c6dbef', '#08519c', '#2171b5',
]

interface Props {
  storeId?: string
}

export function PurposeHeatmap({ storeId }: Props) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (storeId) params.set('storeId', storeId)
    fetch(`/api/v1/admin/analytics/purpose-flow?${params}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [storeId])

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <div className="h-4 bg-gray-100 rounded animate-pulse w-32 mb-4" />
          <div className="h-64 bg-gray-100 rounded animate-pulse" />
        </div>
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <div className="h-4 bg-gray-100 rounded animate-pulse w-48 mb-4" />
          <div className="h-48 bg-gray-100 rounded animate-pulse" />
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-6 text-center text-gray-400 text-sm">
        データを読み込めませんでした
      </div>
    )
  }

  // Calculate max for heatmap normalization
  const maxCount = Math.max(1, ...data.heatmap.flatMap(row => row))

  return (
    <div className="space-y-6">
      {/* Pie Chart: by purpose */}
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h3 className="text-base font-semibold text-[#1e3a5f] mb-4">訪問目的の内訳</h3>
        {data.by_purpose.length === 0 ? (
          <p className="text-center text-gray-400 text-sm py-8">データがありません</p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={data.by_purpose}
                dataKey="count"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, percent }) =>
                  `${name} ${Math.round((percent ?? 0) * 100)}%`
                }
                labelLine={false}
              >
                {data.by_purpose.map((_, idx) => (
                  <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [`${value}件`, '来訪数']} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 7x24 Heatmap */}
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h3 className="text-base font-semibold text-[#1e3a5f] mb-4">来訪ヒートマップ（曜日 × 時間帯）</h3>
        <div className="overflow-x-auto">
          <div className="min-w-max">
            {/* Hour labels */}
            <div className="flex items-center mb-1">
              <div className="w-8 flex-shrink-0" />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="w-8 text-center text-xs text-gray-400 flex-shrink-0">
                  {h % 3 === 0 ? `${h}` : ''}
                </div>
              ))}
            </div>

            {/* Grid: 7 rows (Sun-Sat) x 24 cols */}
            {DAY_NAMES.map((day, dow) => (
              <div key={dow} className="flex items-center mb-1">
                <div className="w-8 text-right pr-2 text-xs text-gray-500 flex-shrink-0">{day}</div>
                {data.heatmap[dow].map((count, hour) => {
                  const intensity = count / maxCount
                  const opacity = count === 0 ? 0.05 : 0.1 + intensity * 0.9
                  return (
                    <div
                      key={hour}
                      className="w-8 h-6 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: `rgba(30, 58, 95, ${opacity})` }}
                      title={`${day}曜 ${hour}時: ${count}件`}
                    />
                  )
                })}
              </div>
            ))}

            {/* Legend */}
            <div className="flex items-center gap-2 mt-3 ml-8">
              <span className="text-xs text-gray-400">少</span>
              {[0.05, 0.25, 0.45, 0.65, 0.85, 1.0].map((op, i) => (
                <div
                  key={i}
                  className="w-5 h-4 rounded-sm"
                  style={{ backgroundColor: `rgba(30, 58, 95, ${op})` }}
                />
              ))}
              <span className="text-xs text-gray-400">多</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
