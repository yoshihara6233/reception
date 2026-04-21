'use client'

import { useEffect, useState } from 'react'
import { useSiteConfig } from '@/lib/site-config'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'

type Period  = 'day' | 'week' | 'month'
type Metric  = 'visits' | 'inspection_rate' | 'unmatch_rate' | 'flagged'

interface Store { id: string; name: string }
interface RawPoint { date: string; visit_count: number; store_id: string }

const STORE_COLORS = ['var(--ge-accent)', '#3b82f6', '#10b981', '#f59e0b', '#ef4444']

const METRICS: { value: Metric; label: string }[] = [
  { value: 'visits',           label: '来訪数' },
  { value: 'inspection_rate',  label: '手荷物検査率 (%)' },
  { value: 'unmatch_rate',     label: 'アンマッチ率 (%)' },
  { value: 'flagged',          label: 'フラグ件数' },
]

// ── データ整形 ────────────────────────────────────────────────────────────────

function buildChartData(
  raw: RawPoint[], stores: Store[], selectedStore: string,
): Record<string, string | number>[] {
  const storeIds = selectedStore === 'all' ? stores.map(s => s.id) : [selectedStore]
  const map = new Map<string, Map<string, number>>()
  for (const p of raw) {
    if (!storeIds.includes(p.store_id)) continue
    if (!map.has(p.date)) map.set(p.date, new Map())
    map.get(p.date)!.set(p.store_id, (map.get(p.date)!.get(p.store_id) ?? 0) + p.visit_count)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => {
      const row: Record<string, string | number> = { date: fmtDate(date) }
      for (const sid of storeIds) row[sid] = counts.get(sid) ?? 0
      return row
    })
}

function fmtDate(d: string): string {
  const dt = new Date(d + 'T00:00:00')
  return `${dt.getMonth() + 1}/${dt.getDate()}`
}

// ── コンポーネント ─────────────────────────────────────────────────────────────

export function TrendChart() {
  const { locationName } = useSiteConfig()
  const [period,        setPeriod]        = useState<Period>('day')
  const [metric,        setMetric]        = useState<Metric>('visits')
  const [selectedStore, setSelectedStore] = useState('all')
  const [stores,        setStores]        = useState<Store[]>([])
  const [rawData,       setRawData]       = useState<RawPoint[]>([])
  const [loading,       setLoading]       = useState(true)

  useEffect(() => {
    fetch('/api/v1/admin/stores')
      .then(r => r.ok ? r.json() : { stores: [] })
      .then(d => setStores(d.stores ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ period })
    fetch(`/api/v1/admin/analytics/visits-trend?${params}`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => setRawData(d.data ?? []))
      .catch(() => setRawData([]))
      .finally(() => setLoading(false))
  }, [period])

  const chartData = buildChartData(rawData, stores, selectedStore)

  const lines = selectedStore === 'all'
    ? stores.map((s, i) => ({ storeId: s.id, name: s.name, color: STORE_COLORS[i % STORE_COLORS.length] }))
    : [{ storeId: selectedStore, name: stores.find(s => s.id === selectedStore)?.name ?? '', color: STORE_COLORS[0] }]

  // 手荷物検査率の目標ライン
  const goalLine = metric === 'inspection_rate' ? 80 : undefined

  return (
    <div style={{
      background: '#fff',
      border: '1px solid var(--ge-line)',
      borderRadius: 6,
      padding: '16px 20px',
      marginBottom: 20,
    }}>
      {/* ヘッダー */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{
          font: '600 10px/1 var(--ge-font-latin)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--ge-ink-3)',
        }}>
          推移グラフ
        </span>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* 指標切替 */}
          <select
            value={metric}
            onChange={e => setMetric(e.target.value as Metric)}
            style={{
              height: 30, fontSize: 11, padding: '0 8px',
              border: '1px solid var(--ge-line)',
              borderRadius: 4,
              background: '#fff',
              color: 'var(--ge-ink)',
              fontFamily: 'var(--ge-font-jp)',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {METRICS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>

          {/* 期間切替 */}
          <div style={{
            display: 'flex',
            border: '1px solid var(--ge-line)',
            borderRadius: 4,
            overflow: 'hidden',
          }}>
            {(['day', 'week', 'month'] as Period[]).map((p, i) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  padding: '5px 10px',
                  font: '500 11px/1 var(--ge-font-jp)',
                  color: period === p ? '#fff' : 'var(--ge-ink-3)',
                  background: period === p ? 'var(--ge-accent)' : '#fff',
                  border: 'none',
                  borderRight: i < 2 ? '1px solid var(--ge-line)' : 'none',
                  cursor: 'pointer',
                  transition: 'background 100ms, color 100ms',
                }}
              >
                {p === 'day' ? '日次' : p === 'week' ? '週次' : '月次'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 店舗タブ */}
      {stores.length > 1 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          <button
            onClick={() => setSelectedStore('all')}
            style={{
              padding: '4px 10px',
              font: '500 11px/1 var(--ge-font-jp)',
              color: selectedStore === 'all' ? '#fff' : 'var(--ge-ink-3)',
              background: selectedStore === 'all' ? 'var(--ge-accent)' : 'var(--ge-paper-2)',
              border: '1px solid var(--ge-line)',
              borderRadius: 2,
              cursor: 'pointer',
              transition: 'background 100ms, color 100ms',
            }}
          >
            全{locationName}
          </button>
          {stores.map((s, i) => {
            const color  = STORE_COLORS[i % STORE_COLORS.length]
            const active = selectedStore === s.id
            return (
              <button
                key={s.id}
                onClick={() => setSelectedStore(s.id)}
                style={{
                  padding: '4px 10px',
                  font: '500 11px/1 var(--ge-font-jp)',
                  color: active ? '#fff' : 'var(--ge-ink-3)',
                  background: active ? color : 'var(--ge-paper-2)',
                  border: `1px solid ${active ? color : 'var(--ge-line)'}`,
                  borderRadius: 2,
                  cursor: 'pointer',
                  transition: 'background 100ms, color 100ms',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: 999,
                  background: active ? '#fff' : color,
                  flexShrink: 0,
                }} />
                {s.name}
              </button>
            )
          })}
        </div>
      )}

      {/* グラフ */}
      {loading ? (
        <div style={{ height: 224, background: 'var(--ge-paper-2)', borderRadius: 4, animation: 'pulse 1.5s infinite' }} />
      ) : chartData.length === 0 ? (
        <div style={{ height: 224, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ge-ink-4)', font: '400 12px/1 var(--ge-font-jp)' }}>データがありません</div>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={chartData} margin={{ top: 5, right: 16, left: -20, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--ge-paper)" />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={{ backgroundColor: 'white', border: '1px solid var(--ge-line)', borderRadius: '4px', fontSize: '12px', fontFamily: 'var(--ge-font-jp)' }}
              formatter={(v) => [`${v ?? 0}${metric.includes('rate') ? '%' : '件'}`]}
            />
            {lines.length > 1 && (
              <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                formatter={v => <span style={{ color: '#374151' }}>{v}</span>} />
            )}
            {goalLine !== undefined && (
              <ReferenceLine y={goalLine} stroke="var(--ge-accent)" strokeDasharray="4 4" strokeWidth={1}
                label={{ value: `目標${goalLine}%`, position: 'right', fontSize: 10, fill: 'var(--ge-accent)' }} />
            )}
            {lines.map(l => (
              <Line key={l.storeId} type="monotone" dataKey={l.storeId} name={l.name}
                stroke={l.color} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
