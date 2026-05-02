'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useLocale } from '@/lib/i18n/useLocale'

// ── 型 ────────────────────────────────────────────────────────────────────────

interface BaggageDecl {
  id: string
  status: string
  context: 'checkin' | 'checkout'
  inspection_mode: 'photo' | 'video' | null
}

interface Visit {
  id: string
  purpose: string
  status: string
  check_in_at: string
  check_out_at: string | null
  visitors: { company: string; name: string; department?: string } | null
  stores: { id: string; name: string } | null
  baggage_declarations: BaggageDecl[] | null
}

interface Store { id: string; name: string }

type SortCol = 'check_in_at' | 'check_out_at' | 'status' | 'purpose'
type SortDir = 'asc' | 'desc'

interface Filters {
  q: string
  company: string
  purpose: string
  storeId: string
  dateFrom: string
  dateTo: string
  status: string
}

const EMPTY_FILTERS: Filters = {
  q: '', company: '', purpose: '', storeId: '',
  dateFrom: '', dateTo: '', status: '',
}

// ── サブコンポーネント ─────────────────────────────────────────────────────────

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const styles: Record<string, React.CSSProperties> = {
    checked_in:  { background: 'var(--ge-success-soft)', color: 'var(--ge-success)' },
    checked_out: { background: 'var(--ge-paper-2)',      color: 'var(--ge-ink-3)' },
    auto_closed: { background: 'var(--ge-warning-soft)', color: 'var(--ge-warning)' },
  }
  const labelKeys: Record<string, string> = {
    checked_in:  'admin.statusCheckedIn',
    checked_out: 'admin.statusCheckedOut',
    auto_closed: 'admin.statusAutoClosed',
  }
  return (
    <span style={{
      ...(styles[status] ?? {}),
      padding: '2px 8px', borderRadius: 999,
      font: '500 11px/1.4 var(--font-sans)',
      whiteSpace: 'nowrap',
    }}>
      {labelKeys[status] ? t(labelKeys[status]) : status}
    </span>
  )
}

function BaggageBadge({ decls }: { decls: BaggageDecl[] | null }) {
  if (!decls || decls.length === 0) return null
  const hasFlagged = decls.some(d => d.status === 'flagged')
  const hasPending = decls.some(d => d.status === 'pending' || d.status === '')
  const allCleared = decls.every(d => d.status === 'cleared')
  if (hasFlagged) return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 6px', borderRadius: 999,
      font: '500 10px/1 var(--font-sans)',
      background: '#fef2f2', color: '#b91c1c',
      border: '1px solid #fecaca', whiteSpace: 'nowrap',
    }}>🚩 フラグ</span>
  )
  if (hasPending) return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 6px', borderRadius: 999,
      font: '500 10px/1 var(--font-sans)',
      background: '#fefce8', color: '#a16207',
      border: '1px solid #fde68a', whiteSpace: 'nowrap',
    }}>⚠️ 未審査</span>
  )
  if (allCleared) return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: '2px 6px', borderRadius: 999,
      font: '500 10px/1 var(--font-sans)',
      background: '#f0fdf4', color: '#15803d',
      border: '1px solid #bbf7d0', whiteSpace: 'nowrap',
    }}>✓ 済</span>
  )
  return null
}

function BaggageModeCell({ decls }: { decls: BaggageDecl[] | null }) {
  if (!decls || decls.length === 0) return <span style={{ color: 'var(--ge-line-2)' }}>—</span>
  const videoDecl = decls.find(d => d.inspection_mode === 'video')
  if (videoDecl) {
    return (
      <Link
        href={`/admin/baggage/${videoDecl.id}/recording`}
        onClick={e => e.stopPropagation()}
        title="録画を見る"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 8px', borderRadius: 6,
          font: '600 11px/1.4 var(--font-sans)',
          color: '#7c3aed', background: '#f5f3ff',
          border: '1px solid #ddd6fe', textDecoration: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        🎥 動画
      </Link>
    )
  }
  return (
    <span style={{
      font: '400 11px/1 var(--font-sans)',
      color: 'var(--ge-ink-4)',
      whiteSpace: 'nowrap',
    }}>
      📷 写真
    </span>
  )
}

function SortTh({
  col, label, sortCol, sortDir, onSort,
}: {
  col: SortCol | null
  label: string
  sortCol: SortCol
  sortDir: SortDir
  onSort: (c: SortCol) => void
}) {
  const active = col === sortCol
  const cellStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left',
    font: '500 11px/1 var(--font-sans)',
    color: active ? 'var(--ge-accent)' : 'var(--ge-ink-4)',
    whiteSpace: 'nowrap',
    cursor: col ? 'pointer' : 'default',
    userSelect: 'none',
  }
  return (
    <th style={cellStyle} onClick={() => col && onSort(col)}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {label}
        {col && (
          <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1, opacity: active ? 1 : 0.3 }}>
            <svg width="7" height="4" viewBox="0 0 8 5" fill="currentColor" style={{ opacity: sortDir === 'asc' && active ? 1 : 0.4 }}>
              <path d="M4 0L8 5H0L4 0Z"/>
            </svg>
            <svg width="7" height="4" viewBox="0 0 8 5" fill="currentColor" style={{ marginTop: 2, opacity: sortDir === 'desc' && active ? 1 : 0.4 }}>
              <path d="M4 5L0 0H8L4 5Z"/>
            </svg>
          </span>
        )}
      </span>
    </th>
  )
}

function FilterInput({ value, onChange, placeholder, type = 'text' }: {
  value: string; onChange: (v: string) => void
  placeholder?: string; type?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', padding: '4px 8px',
        font: '400 11px/1.4 var(--font-sans)',
        color: 'var(--ge-ink)', background: '#fff',
        border: '1px solid var(--ge-line)', borderRadius: 4,
        outline: 'none',
      }}
    />
  )
}

// ── タイムラインイベント ────────────────────────────────────────────────────────

type TimelineEvent = {
  key: string
  type: 'checkin' | 'checkout'
  time: string
  visit: Visit
}

function buildTimeline(visits: Visit[]): TimelineEvent[] {
  const events: TimelineEvent[] = []
  for (const v of visits) {
    events.push({ key: `${v.id}-in`, type: 'checkin', time: v.check_in_at, visit: v })
    if (v.check_out_at) {
      events.push({ key: `${v.id}-out`, type: 'checkout', time: v.check_out_at, visit: v })
    }
  }
  return events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
}

// ── メインページ ──────────────────────────────────────────────────────────────

export default function VisitsPage() {
  const { t, locale } = useLocale()
  const dateLocale = locale === 'zh' ? 'zh-CN' : locale === 'ko' ? 'ko-KR' : locale === 'en' ? 'en-US' : 'ja-JP'

  const [visits,    setVisits]    = useState<Visit[]>([])
  const [total,     setTotal]     = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [page,      setPage]      = useState(1)
  const [exporting, setExporting] = useState(false)
  const [stores,    setStores]    = useState<Store[]>([])
  const [purposes,  setPurposes]  = useState<string[]>([])
  const [viewMode,  setViewMode]  = useState<'table' | 'timeline'>('table')

  // 選択状態
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // 手荷物フィルター（クライアントサイド）
  const [baggageFilter, setBaggageFilter] = useState<'' | 'flagged' | 'pending' | 'cleared' | 'none'>('')

  const [filters,  setFilters]  = useState<Filters>(EMPTY_FILTERS)
  const [sortCol,  setSortCol]  = useState<SortCol>('check_in_at')
  const [sortDir,  setSortDir]  = useState<SortDir>('desc')

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const perPage = 20
  const totalPages = Math.ceil(total / perPage)
  const hasFilters = Object.values(filters).some(v => v !== '') || !!baggageFilter

  // ── 店舗一覧・目的一覧 ────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/v1/admin/stores')
      .then(r => r.ok ? r.json() : { stores: [] })
      .then(d => setStores(d.stores ?? []))
      .catch(() => {})
    fetch('/api/v1/admin/settings')
      .then(r => r.ok ? r.json() : {})
      .then(d => {
        const p = (d as Record<string, unknown> & { settings?: { visit_purposes?: unknown } })?.settings?.visit_purposes
        if (Array.isArray(p) && p.length > 0) setPurposes(p)
        else setPurposes(['定期配送', 'メンテナンス', '商談', '監査', 'その他'])
      })
      .catch(() => setPurposes(['定期配送', 'メンテナンス', '商談', '監査', 'その他']))
  }, [])

  // ── データ取得 ────────────────────────────────────────────────────────────────
  const fetchVisits = useCallback(async (pg = 1, f = filters, sc = sortCol, sd = sortDir) => {
    setLoading(true)
    setSelected(new Set()) // ページ切替時に選択リセット
    const p = new URLSearchParams()
    if (f.q)        p.set('q',        f.q)
    if (f.company)  p.set('company',  f.company)
    if (f.purpose)  p.set('purpose',  f.purpose)
    if (f.storeId)  p.set('storeId',  f.storeId)
    if (f.dateFrom) p.set('dateFrom', f.dateFrom)
    if (f.dateTo)   p.set('dateTo',   f.dateTo)
    if (f.status)   p.set('status',   f.status)
    p.set('sortBy',  sc)
    p.set('sortDir', sd)
    p.set('page',    String(pg))
    try {
      const res = await fetch(`/api/v1/admin/visits-list?${p}`)
      const data = await res.json()
      setVisits(data.visits || [])
      setTotal(data.total || 0)
      setPage(pg)
    } catch {}
    setLoading(false)
  }, [filters, sortCol, sortDir])

  const applyFilters = useCallback((f: Filters, sc: SortCol, sd: SortDir) => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchVisits(1, f, sc, sd), 280)
  }, [fetchVisits])

  useEffect(() => { fetchVisits(1) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── フィルター ────────────────────────────────────────────────────────────────
  const updateFilter = (key: keyof Filters, val: string) => {
    const next = { ...filters, [key]: val }
    setFilters(next)
    applyFilters(next, sortCol, sortDir)
  }
  const clearFilters = () => {
    setFilters(EMPTY_FILTERS)
    setBaggageFilter('')
    applyFilters(EMPTY_FILTERS, sortCol, sortDir)
  }

  // ── ソート ────────────────────────────────────────────────────────────────────
  const handleSort = (col: SortCol) => {
    const nextDir: SortDir = sortCol === col && sortDir === 'desc' ? 'asc' : 'desc'
    setSortCol(col); setSortDir(nextDir)
    fetchVisits(1, filters, col, nextDir)
  }

  // ── 選択 ─────────────────────────────────────────────────────────────────────
  const allIds = visits.map(v => v.id)
  const allSelected = allIds.length > 0 && allIds.every(id => selected.has(id))
  const someSelected = allIds.some(id => selected.has(id)) && !allSelected

  const toggleAll = () => {
    if (allSelected) {
      setSelected(prev => { const s = new Set(prev); allIds.forEach(id => s.delete(id)); return s })
    } else {
      setSelected(prev => new Set([...prev, ...allIds]))
    }
  }
  const toggleOne = (id: string) => {
    setSelected(prev => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  // ── CSV エクスポート ──────────────────────────────────────────────────────────
  const handleExport = async (selectedOnly = false) => {
    setExporting(true)
    const p = new URLSearchParams()
    if (!selectedOnly) {
      if (filters.q)        p.set('q',        filters.q)
      if (filters.company)  p.set('company',  filters.company)
      if (filters.purpose)  p.set('purpose',  filters.purpose)
      if (filters.storeId)  p.set('storeId',  filters.storeId)
      if (filters.dateFrom) p.set('dateFrom', filters.dateFrom)
      if (filters.dateTo)   p.set('dateTo',   filters.dateTo)
      if (filters.status)   p.set('status',   filters.status)
    } else {
      // 選択IDをカンマ区切りで渡す
      p.set('ids', [...selected].join(','))
    }
    const res = await fetch(`/api/v1/admin/visits-export?${p}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `visits_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  // 手荷物フィルター適用（表示用）
  const getBaggageSummary = (decls: BaggageDecl[] | null): 'flagged' | 'pending' | 'cleared' | 'none' => {
    if (!decls || decls.length === 0) return 'none'
    if (decls.some(d => d.status === 'flagged')) return 'flagged'
    if (decls.some(d => d.status === 'pending' || d.status === '')) return 'pending'
    return 'cleared'
  }
  const displayedVisits = baggageFilter
    ? visits.filter(v => getBaggageSummary(v.baggage_declarations) === baggageFilter)
    : visits

  const sortProps = { sortCol, sortDir, onSort: handleSort }
  const selectedCount = selected.size

  return (
    <div>
      {/* ── ヘッダー ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h1 style={{ font: '700 24px/1.2 var(--font-sans)', color: '#1e3a5f', margin: 0 }}>
            {t('admin.visits')}
          </h1>
          <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--ge-ink-4)' }}>
            {total.toLocaleString()}{t('admin.total')}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {hasFilters && (
            <button
              onClick={clearFilters}
              style={{
                padding: '5px 10px', borderRadius: 4, cursor: 'pointer',
                font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-3)',
                background: 'var(--ge-paper-2)', border: '1px solid var(--ge-line)',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
              絞り込みクリア
            </button>
          )}
          {/* タイムライン / テーブル トグル */}
          <div style={{
            display: 'flex', borderRadius: 4, overflow: 'hidden',
            border: '1px solid var(--ge-line)',
          }}>
            {(['table', 'timeline'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                style={{
                  padding: '5px 10px', cursor: 'pointer',
                  font: '500 11px/1 var(--font-sans)',
                  background: viewMode === mode ? 'var(--ge-accent)' : '#fff',
                  color: viewMode === mode ? '#fff' : 'var(--ge-ink-3)',
                  border: 'none', outline: 'none',
                }}
              >
                {mode === 'table' ? '📋 テーブル' : '⏱ タイムライン'}
              </button>
            ))}
          </div>

          {/* アンマッチ確認リンク */}
          <Link
            href="/admin/visits/mismatch"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 4,
              font: '500 11px/1 var(--font-sans)', color: '#b91c1c',
              background: '#fef2f2', border: '1px solid #fecaca',
              textDecoration: 'none',
            }}
          >
            ⚠️ アンマッチ確認
          </Link>

          <Link
            href="/admin/baggage/review"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 4,
              font: '500 11px/1 var(--font-sans)', color: '#fff',
              background: 'var(--ge-accent)', border: '1px solid var(--ge-accent)',
              textDecoration: 'none',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            手荷物レビュー
          </Link>
          <button
            onClick={() => handleExport(false)}
            disabled={exporting}
            style={{
              padding: '5px 12px', borderRadius: 4, cursor: 'pointer',
              font: '500 11px/1 var(--font-sans)', color: 'var(--ge-accent)',
              background: '#fff', border: '1px solid var(--ge-accent-line)',
              opacity: exporting ? 0.4 : 1,
            }}
          >
            {exporting ? t('admin.exporting') : 'CSV エクスポート'}
          </button>
        </div>
      </div>

      {/* ── 選択バー ─────────────────────────────────────────────────── */}
      {selectedCount > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 14px', marginBottom: 8,
          background: 'var(--ge-accent-soft)', border: '1px solid var(--ge-accent-line)',
          borderRadius: 6,
        }}>
          <span style={{ font: '500 12px/1 var(--font-sans)', color: 'var(--ge-accent-ink)' }}>
            {selectedCount}件を選択中
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => handleExport(true)}
              disabled={exporting}
              style={{
                padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
                font: '500 11px/1 var(--font-sans)', color: '#fff',
                background: 'var(--ge-accent)', border: 'none',
                opacity: exporting ? 0.5 : 1,
              }}
            >
              選択分をCSV出力
            </button>
            <button
              onClick={() => setSelected(new Set())}
              style={{
                padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                font: '500 11px/1 var(--font-sans)', color: 'var(--ge-accent-ink)',
                background: '#fff', border: '1px solid var(--ge-accent-line)',
              }}
            >
              選択解除
            </button>
          </div>
        </div>
      )}

      {/* ── タイムライン ─────────────────────────────────────────────── */}
      {viewMode === 'timeline' && (
        <div style={{ background: '#fff', borderRadius: 6, border: '1px solid var(--ge-line)', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ge-ink-4)', font: '400 13px/1 var(--font-sans)' }}>読み込み中...</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--ge-paper)', borderBottom: '1px solid var(--ge-line)' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', whiteSpace: 'nowrap' }}>時刻</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', whiteSpace: 'nowrap' }}>種別</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', whiteSpace: 'nowrap' }}>訪問者</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', whiteSpace: 'nowrap' }}>会社</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', whiteSpace: 'nowrap' }}>目的</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', whiteSpace: 'nowrap' }}>店舗</th>
                  <th style={{ width: 80 }} />
                </tr>
              </thead>
              <tbody>
                {buildTimeline(displayedVisits).length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ge-ink-4)', font: '400 13px/1 var(--font-sans)' }}>
                      {t('admin.noVisits')}
                    </td>
                  </tr>
                ) : buildTimeline(displayedVisits).map(ev => {
                  const isCheckout = ev.type === 'checkout'
                  const isCheckoutOnly = ev.visit.purpose === '__checkout_only__'
                  return (
                    <tr
                      key={ev.key}
                      style={{
                        borderBottom: '1px solid var(--ge-paper-2)',
                        background: isCheckout ? '#f0fdf4' : '#eff6ff',
                      }}
                    >
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: 'var(--ge-ink-3)', font: '500 11px/1.3 var(--font-mono)' }}>
                        {new Date(ev.time).toLocaleString(dateLocale, {
                          month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit', second: '2-digit',
                        })}
                      </td>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '2px 8px', borderRadius: 999,
                          font: '600 11px/1.4 var(--font-sans)',
                          background: isCheckout ? '#dcfce7' : '#dbeafe',
                          color: isCheckout ? '#15803d' : '#1d4ed8',
                        }}>
                          {isCheckout ? '↑ 退室' : '↓ 入室'}
                          {isCheckoutOnly && (
                            <span style={{ font: '500 10px/1 var(--font-sans)', color: '#9a3412', marginLeft: 2 }}>※</span>
                          )}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                        <Link
                          href={`/admin/visits/${ev.visit.id}`}
                          style={{ font: '500 12px/1.3 var(--font-sans)', color: 'var(--ge-accent)', textDecoration: 'none' }}
                        >
                          {ev.visit.visitors?.name ?? '—'}
                        </Link>
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--ge-ink-2)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ev.visit.visitors?.company ?? '—'}
                      </td>
                      <td style={{ padding: '8px 12px', color: isCheckoutOnly ? '#9a3412' : 'var(--ge-ink-2)', whiteSpace: 'nowrap' }}>
                        {isCheckoutOnly ? '退室のみ ※' : ev.visit.purpose}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--ge-ink-3)', whiteSpace: 'nowrap' }}>
                        {ev.visit.stores?.name ?? '—'}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <Link
                          href={`/admin/visits/${ev.visit.id}`}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            padding: '3px 8px', borderRadius: 4,
                            font: '500 11px/1 var(--font-sans)',
                            color: 'var(--ge-accent)', background: 'var(--ge-accent-soft)',
                            border: '1px solid var(--ge-accent-line)', textDecoration: 'none',
                          }}
                        >詳細 →</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          <div style={{ padding: '8px 14px', borderTop: '1px solid var(--ge-line)', font: '400 10px/1 var(--font-sans)', color: 'var(--ge-ink-4)' }}>
            ※ 入室記録なしで退室した来訪者です。
            <Link href="/admin/visits/mismatch" style={{ marginLeft: 8, color: 'var(--ge-accent)', textDecoration: 'none' }}>
              アンマッチ詳細 →
            </Link>
          </div>
        </div>
      )}

      {/* ── テーブル ─────────────────────────────────────────────────── */}
      {viewMode === 'table' && (
      <div style={{ background: '#fff', borderRadius: 6, border: '1px solid var(--ge-line)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          {/* ── ヘッダー行 ── */}
          <thead>
            <tr style={{ background: 'var(--ge-paper)', borderBottom: '1px solid var(--ge-line)' }}>
              {/* 全選択チェックボックス */}
              <th style={{ width: 36, padding: '8px 0 8px 14px' }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected }}
                  onChange={toggleAll}
                  style={{ cursor: 'pointer', width: 14, height: 14, accentColor: 'var(--ge-accent)' }}
                />
              </th>
              <SortTh col={null}          label={t('admin.visitor')}      {...sortProps} />
              <SortTh col={null}          label={t('admin.company')}      {...sortProps} />
              <SortTh col="purpose"       label={t('admin.purpose')}      {...sortProps} />
              <SortTh col={null}          label={t('admin.store')}        {...sortProps} />
              <SortTh col="check_in_at"  label={t('admin.checkInTime')}  {...sortProps} />
              <SortTh col="check_out_at" label={t('admin.checkOutTime')} {...sortProps} />
              <SortTh col="status"       label={t('admin.status')}       {...sortProps} />
              <th style={{ padding: '8px 12px', textAlign: 'left', font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', whiteSpace: 'nowrap' }}>手荷物</th>
              <th style={{ width: 40 }} />
            </tr>

            {/* ── フィルター行 ── */}
            <tr style={{ background: '#fff', borderBottom: '1px solid var(--ge-line)' }}>
              <td />
              <td style={{ padding: '4px 6px' }}>
                <FilterInput value={filters.q} onChange={v => updateFilter('q', v)} placeholder="氏名で絞込" />
              </td>
              <td style={{ padding: '4px 6px' }}>
                <FilterInput value={filters.company} onChange={v => updateFilter('company', v)} placeholder="会社名で絞込" />
              </td>
              <td style={{ padding: '4px 6px' }}>
                <select
                  value={filters.purpose}
                  onChange={e => updateFilter('purpose', e.target.value)}
                  style={{
                    width: '100%', padding: '4px 8px',
                    font: '400 11px/1.4 var(--font-sans)', color: filters.purpose ? 'var(--ge-ink)' : 'var(--ge-ink-4)',
                    background: '#fff', border: '1px solid var(--ge-line)', borderRadius: 4, outline: 'none',
                  }}
                >
                  <option value="">すべて</option>
                  {purposes.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </td>
              <td style={{ padding: '4px 6px' }}>
                <select
                  value={filters.storeId}
                  onChange={e => updateFilter('storeId', e.target.value)}
                  style={{
                    width: '100%', padding: '4px 8px',
                    font: '400 11px/1.4 var(--font-sans)', color: 'var(--ge-ink-3)',
                    background: '#fff', border: '1px solid var(--ge-line)', borderRadius: 4, outline: 'none',
                  }}
                >
                  <option value="">すべて</option>
                  {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </td>
              <td style={{ padding: '4px 6px' }}>
                <FilterInput value={filters.dateFrom} onChange={v => updateFilter('dateFrom', v)} type="date" />
              </td>
              <td style={{ padding: '4px 6px' }}>
                <FilterInput value={filters.dateTo} onChange={v => updateFilter('dateTo', v)} type="date" />
              </td>
              <td style={{ padding: '4px 6px' }}>
                <select
                  value={filters.status}
                  onChange={e => updateFilter('status', e.target.value)}
                  style={{
                    width: '100%', padding: '4px 8px',
                    font: '400 11px/1.4 var(--font-sans)', color: 'var(--ge-ink-3)',
                    background: '#fff', border: '1px solid var(--ge-line)', borderRadius: 4, outline: 'none',
                  }}
                >
                  <option value="">すべて</option>
                  <option value="checked_in">{t('admin.statusCheckedIn')}</option>
                  <option value="checked_out">{t('admin.statusCheckedOut')}</option>
                  <option value="auto_closed">{t('admin.statusAutoClosed')}</option>
                </select>
              </td>
              <td style={{ padding: '4px 6px' }}>
                <select
                  value={baggageFilter}
                  onChange={e => setBaggageFilter(e.target.value as typeof baggageFilter)}
                  style={{
                    width: '100%', padding: '4px 8px',
                    font: '400 11px/1.4 var(--font-sans)', color: baggageFilter ? 'var(--ge-ink)' : 'var(--ge-ink-4)',
                    background: '#fff', border: '1px solid var(--ge-line)', borderRadius: 4, outline: 'none',
                  }}
                >
                  <option value="">すべて</option>
                  <option value="flagged">🚩 フラグあり</option>
                  <option value="pending">⚠️ 未審査あり</option>
                  <option value="cleared">✓ 済</option>
                  <option value="none">申告なし</option>
                </select>
              </td>
              <td />
            </tr>
          </thead>

          {/* ── ボディ ── */}
          <tbody>
            {loading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--ge-paper-2)' }}>
                  <td style={{ padding: '8px 14px' }}>
                    <div style={{ width: 14, height: 14, background: 'var(--ge-paper-2)', borderRadius: 2 }} />
                  </td>
                  {[...Array(9)].map((_, j) => (
                    <td key={j} style={{ padding: '10px 12px' }}>
                      <div style={{
                        height: 12, borderRadius: 3, background: 'var(--ge-paper-2)',
                        width: `${50 + (i * j + 13) % 40}%`,
                        animation: 'pulse 1.5s ease-in-out infinite',
                      }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : displayedVisits.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ge-ink-4)', font: '400 13px/1 var(--font-sans)' }}>
                  {hasFilters || baggageFilter ? (
                    <div>
                      <p style={{ marginBottom: 8 }}>条件に一致する来訪記録がありません</p>
                      <button
                        onClick={() => { clearFilters(); setBaggageFilter('') }}
                        style={{ font: '500 11px/1 var(--font-sans)', color: 'var(--ge-accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        絞り込みをクリア
                      </button>
                    </div>
                  ) : t('admin.noVisits')}
                </td>
              </tr>
            ) : (
              displayedVisits.map(visit => {
                const isSelected = selected.has(visit.id)
                return (
                  <tr
                    key={visit.id}
                    style={{
                      borderBottom: '1px solid var(--ge-paper-2)',
                      background: isSelected ? 'var(--ge-accent-soft)' : undefined,
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleOne(visit.id)}
                  >
                    {/* チェックボックス */}
                    <td style={{ padding: '10px 0 10px 14px' }} onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(visit.id)}
                        style={{ cursor: 'pointer', width: 14, height: 14, accentColor: 'var(--ge-accent)' }}
                      />
                    </td>
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <Link
                        href={`/admin/visits/${visit.id}`}
                        onClick={e => e.stopPropagation()}
                        style={{ font: '500 12px/1.3 var(--font-sans)', color: 'var(--ge-accent)', textDecoration: 'none' }}
                      >
                        {visit.visitors?.name ?? '—'}
                      </Link>
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--ge-ink-2)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {visit.visitors?.company ?? '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--ge-ink-2)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {visit.purpose}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--ge-ink-3)', whiteSpace: 'nowrap' }}>
                      {visit.stores?.name ?? '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--ge-ink-3)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {new Date(visit.check_in_at).toLocaleString(dateLocale, {
                        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'var(--ge-ink-3)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {visit.check_out_at
                        ? new Date(visit.check_out_at).toLocaleString(dateLocale, {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })
                        : <span style={{ color: 'var(--ge-line-2)' }}>—</span>}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <StatusBadge status={visit.status} t={t} />
                    </td>
                    <td style={{ padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <BaggageModeCell decls={visit.baggage_declarations} />
                        <BaggageBadge decls={visit.baggage_declarations} />
                      </div>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <Link
                        href={`/admin/visits/${visit.id}`}
                        onClick={e => e.stopPropagation()}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '3px 8px', borderRadius: 4,
                          font: '500 11px/1 var(--font-sans)',
                          color: 'var(--ge-accent)', background: 'var(--ge-accent-soft)',
                          border: '1px solid var(--ge-accent-line)', textDecoration: 'none',
                        }}
                      >
                        詳細 →
                      </Link>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      )}

      {/* ── ページネーション ──────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 16 }}>
          <button
            onClick={() => fetchVisits(Math.max(1, page - 1))}
            disabled={page === 1}
            style={{
              padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
              font: '500 13px/1 var(--font-sans)', color: 'var(--ge-ink-3)',
              background: '#fff', border: '1px solid var(--ge-line)',
              opacity: page === 1 ? 0.3 : 1,
            }}
          >‹</button>
          {(() => {
            const pages: (number | '...')[] = []
            for (let p = 1; p <= totalPages; p++) {
              if (p === 1 || p === totalPages || (p >= page - 2 && p <= page + 2)) pages.push(p)
              else if (pages[pages.length - 1] !== '...') pages.push('...')
            }
            return pages.map((p, i) =>
              p === '...' ? (
                <span key={`d${i}`} style={{ padding: '0 4px', color: 'var(--ge-ink-4)', font: '400 13px/1 var(--font-sans)' }}>…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => fetchVisits(p as number)}
                  style={{
                    padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
                    font: '500 13px/1 var(--font-sans)',
                    background: p === page ? 'var(--ge-accent)' : '#fff',
                    color: p === page ? '#fff' : 'var(--ge-ink-3)',
                    border: `1px solid ${p === page ? 'var(--ge-accent)' : 'var(--ge-line)'}`,
                  }}
                >{p}</button>
              )
            )
          })()}
          <button
            onClick={() => fetchVisits(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            style={{
              padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
              font: '500 13px/1 var(--font-sans)', color: 'var(--ge-ink-3)',
              background: '#fff', border: '1px solid var(--ge-line)',
              opacity: page === totalPages ? 0.3 : 1,
            }}
          >›</button>
          <span style={{ marginLeft: 8, font: '400 11px/1 var(--font-mono)', color: 'var(--ge-ink-4)' }}>
            {page} / {totalPages}
          </span>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
