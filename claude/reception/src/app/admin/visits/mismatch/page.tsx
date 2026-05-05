'use client'

/**
 * /admin/visits/mismatch
 *
 * 指定日の全来訪記録を1テーブルで表示。
 * 種別（正常 / 未退室 / 退室のみ）・名前・所属・店舗・入室時刻・退室時刻で絞り込み可能。
 * 同一訪問者の複数レコードを1行にグルーピングし、時刻をチップで列挙。
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { VisitsNavBar } from '@/app/admin/_components/VisitsNavBar'

// ── 型定義 ─────────────────────────────────────────────────────────────────

type MismatchType = 'normal' | 'unmatched_checkin' | 'checkout_only'
type SortCol = 'type' | 'name' | 'company' | 'store' | 'checkin' | 'checkout'
type SortDir = 'asc' | 'desc'

interface RawVisit {
  id: string
  visitor_id: string
  purpose: string
  status: string
  check_in_at: string | null
  check_out_at: string | null
  mismatch_type: MismatchType
  visitors: { company: string; name: string; department?: string } | null
  stores: { id: string; name: string } | null
}

interface Summary {
  total: number
  normal: number
  unmatched_checkin: number
  checkout_only: number
}

interface ApiResponse {
  date: string
  visits: RawVisit[]
  summary: Summary
}

/** 訪問者単位にグルーピングした表示行 */
interface VisitorRow {
  visitor_id: string
  name: string
  company: string
  department: string
  stores: string[]        // ユニーク店舗名リスト
  mismatch_type: MismatchType
  checkins: string[]      // HH:MM 昇順
  checkouts: string[]     // HH:MM 昇順
}

// ── ユーティリティ ────────────────────────────────────────────────────────

function yesterday(): string {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + delta)
  return d.toISOString().slice(0, 10)
}

function fmtTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ja-JP', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

/** 種別の優先度（高いほど重大） */
const TYPE_PRIORITY: Record<MismatchType, number> = {
  unmatched_checkin: 3,
  checkout_only: 2,
  normal: 1,
}

/** RawVisit[] を visitor_id でグルーピングして VisitorRow[] に変換 */
function groupByVisitor(visits: RawVisit[]): VisitorRow[] {
  const map = new Map<string, VisitorRow>()

  for (const v of visits) {
    const vid = v.visitor_id

    if (!map.has(vid)) {
      map.set(vid, {
        visitor_id: vid,
        name: v.visitors?.name ?? '—',
        company: v.visitors?.company ?? '—',
        department: v.visitors?.department ?? '',
        stores: [],
        mismatch_type: v.mismatch_type,
        checkins: [],
        checkouts: [],
      })
    }

    const row = map.get(vid)!

    // 最重大な種別を採用
    if (TYPE_PRIORITY[v.mismatch_type] > TYPE_PRIORITY[row.mismatch_type]) {
      row.mismatch_type = v.mismatch_type
    }

    // 店舗名（重複除去）
    const sname = v.stores?.name
    if (sname && !row.stores.includes(sname)) row.stores.push(sname)

    // 入室時刻（checkout_only は check_in_at が null なので除外される）
    const ci = fmtTime(v.check_in_at)
    if (ci && !row.checkins.includes(ci)) row.checkins.push(ci)

    // 退室時刻
    const co = fmtTime(v.check_out_at)
    if (co && !row.checkouts.includes(co)) row.checkouts.push(co)
  }

  // 時刻を昇順ソート
  for (const row of map.values()) {
    row.checkins.sort()
    row.checkouts.sort()
  }

  return Array.from(map.values())
}

// ── スタイル定数 ───────────────────────────────────────────────────────────

const TH: React.CSSProperties = {
  padding: '8px 10px',
  textAlign: 'left',
  font: '600 11px/1 var(--font-sans)',
  color: 'var(--ge-ink-4)',
  background: '#f8fafc',
  whiteSpace: 'nowrap',
  userSelect: 'none',
}

const TD: React.CSSProperties = {
  padding: '9px 10px',
  color: 'var(--ge-ink-2)',
  borderTop: '1px solid #f1f5f9',
  verticalAlign: 'middle',
}

const FILTER_INPUT: React.CSSProperties = {
  width: '100%',
  padding: '4px 7px',
  border: '1px solid var(--ge-line)',
  borderRadius: 4,
  font: '400 11px/1 var(--font-sans)',
  color: 'var(--ge-ink)',
  outline: 'none',
  background: '#fff',
}

const FILTER_SELECT: React.CSSProperties = {
  ...FILTER_INPUT,
}

// ── サブコンポーネント ─────────────────────────────────────────────────────

function TypeBadge({ type }: { type: MismatchType }) {
  const map: Record<MismatchType, { bg: string; color: string; border: string; label: string }> = {
    normal:            { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0', label: '✓ 正常' },
    unmatched_checkin: { bg: '#fef2f2', color: '#b91c1c', border: '#fecaca', label: '未退室' },
    checkout_only:     { bg: '#fff7ed', color: '#c2410c', border: '#fed7aa', label: '退室のみ' },
  }
  const s = map[type]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 999,
      font: '600 11px/1.4 var(--font-sans)',
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

function TimeChips({ times, variant }: { times: string[]; variant: 'in' | 'out' }) {
  if (times.length === 0) {
    return (
      <span style={{
        display: 'inline-flex', padding: '2px 7px', borderRadius: 4,
        font: '500 11px/1.5 var(--font-sans)',
        background: '#f8fafc', color: '#94a3b8',
        border: '1px solid #e2e8f0',
      }}>—</span>
    )
  }
  const style: React.CSSProperties = variant === 'in'
    ? { background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }
    : { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }

  return (
    <>
      {times.map(t => (
        <span key={t} style={{
          display: 'inline-flex', padding: '2px 7px', borderRadius: 4, marginRight: 3,
          font: '500 11px/1.5 var(--font-sans)',
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          ...style,
        }}>{t}</span>
      ))}
    </>
  )
}

function SortIcon({ col, current, dir }: { col: SortCol; current: SortCol; dir: SortDir }) {
  if (col !== current) return <span style={{ opacity: 0.3, marginLeft: 3 }}>↕</span>
  return <span style={{ marginLeft: 3, color: 'var(--ge-accent)' }}>{dir === 'asc' ? '↑' : '↓'}</span>
}

// ── メインコンポーネント ───────────────────────────────────────────────────

export default function MismatchPage() {
  const [date, setDate] = useState(yesterday())
  const [apiData, setApiData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)

  // フィルター
  const [fType,    setFType]    = useState('')
  const [fName,    setFName]    = useState('')
  const [fCompany, setFCompany] = useState('')
  const [fStore,   setFStore]   = useState('')
  const [fCheckin, setFCheckin] = useState('')
  const [fCheckout,setFCheckout]= useState('')

  // ソート
  const [sortCol, setSortCol] = useState<SortCol>('type')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // ── データ取得 ──────────────────────────────────────────────────────────
  const load = useCallback(async (d: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/admin/mismatch?date=${d}`)
      if (res.ok) setApiData(await res.json())
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { load(date) }, [date, load])

  // ── グルーピング + フィルター + ソート ─────────────────────────────────
  const rows = useMemo<VisitorRow[]>(() => {
    if (!apiData) return []

    let grouped = groupByVisitor(apiData.visits)

    // フィルター
    if (fType)    grouped = grouped.filter(r => r.mismatch_type === fType)
    if (fName)    grouped = grouped.filter(r => r.name.includes(fName))
    if (fCompany) grouped = grouped.filter(r =>
      (r.company + r.department).toLowerCase().includes(fCompany.toLowerCase())
    )
    if (fStore)   grouped = grouped.filter(r => r.stores.includes(fStore))
    if (fCheckin) grouped = grouped.filter(r => r.checkins.some(t => t.startsWith(fCheckin)))
    if (fCheckout)grouped = grouped.filter(r => r.checkouts.some(t => t.startsWith(fCheckout)))

    // ソート
    grouped = [...grouped].sort((a, b) => {
      let va: string | number = ''
      let vb: string | number = ''
      if (sortCol === 'type')     { va = TYPE_PRIORITY[a.mismatch_type]; vb = TYPE_PRIORITY[b.mismatch_type] }
      if (sortCol === 'name')     { va = a.name;    vb = b.name }
      if (sortCol === 'company')  { va = a.company; vb = b.company }
      if (sortCol === 'store')    { va = a.stores[0] ?? ''; vb = b.stores[0] ?? '' }
      if (sortCol === 'checkin')  { va = a.checkins[0]  ?? ''; vb = b.checkins[0]  ?? '' }
      if (sortCol === 'checkout') { va = a.checkouts[0] ?? ''; vb = b.checkouts[0] ?? '' }

      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })

    return grouped
  }, [apiData, fType, fName, fCompany, fStore, fCheckin, fCheckout, sortCol, sortDir])

  // 店舗リスト（フィルター用）
  const storeOptions = useMemo(() => {
    if (!apiData) return []
    const names = new Set(apiData.visits.map(v => v.stores?.name).filter(Boolean) as string[])
    return Array.from(names).sort()
  }, [apiData])

  // ソート切替
  function handleSort(col: SortCol) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('desc') }
  }

  // 日付変更
  function changeDate(delta: number) {
    const next = addDays(date, delta)
    if (next <= today()) setDate(next)
  }

  // ── 行スタイル（左ボーダー色） ─────────────────────────────────────────
  function rowStyle(type: MismatchType): React.CSSProperties {
    const borderMap: Record<MismatchType, string> = {
      normal:            '#22c55e',
      unmatched_checkin: '#ef4444',
      checkout_only:     '#f97316',
    }
    return { borderLeft: `3px solid ${borderMap[type]}` }
  }

  const summary = apiData?.summary

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 14 }}>

      {/* ── ページヘッダー ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{
            font: '700 22px/1.2 var(--font-sans)', color: '#1e3a5f',
            margin: 0, display: 'flex', alignItems: 'center', gap: 10,
          }}>
            アンマッチ確認
            {!loading && summary && summary.unmatched_checkin + summary.checkout_only > 0 && (
              <span style={{
                padding: '2px 10px', borderRadius: 999,
                font: '600 12px/1.6 var(--font-sans)',
                background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca',
              }}>
                ⚠ {summary.unmatched_checkin + summary.checkout_only} 件
              </span>
            )}
          </h1>
          <p style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--ge-ink-4)', marginTop: 4 }}>
            指定日の全来訪記録。赤＝未退室、橙＝退室のみ、緑＝正常
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <VisitsNavBar />

          {/* 日付ナビ */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              onClick={() => changeDate(-1)}
              style={{
                width: 28, height: 28, borderRadius: 4, cursor: 'pointer',
                font: '400 16px/1 var(--font-sans)', color: 'var(--ge-ink-3)',
                background: '#fff', border: '1px solid var(--ge-line)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >‹</button>
            <input
              type="date"
              value={date}
              max={today()}
              onChange={e => setDate(e.target.value)}
              style={{
                padding: '5px 10px', borderRadius: 4,
                font: '500 13px/1 var(--font-sans)', color: 'var(--ge-ink)',
                background: '#fff', border: '1px solid var(--ge-line)', outline: 'none',
              }}
            />
            <button
              onClick={() => changeDate(1)}
              disabled={date >= today()}
              style={{
                width: 28, height: 28, borderRadius: 4,
                cursor: date >= today() ? 'default' : 'pointer',
                font: '400 16px/1 var(--font-sans)',
                color: date >= today() ? '#cbd5e1' : 'var(--ge-ink-3)',
                background: '#fff', border: '1px solid var(--ge-line)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >›</button>
            {date !== today() && (
              <button
                onClick={() => setDate(today())}
                style={{
                  padding: '5px 10px', borderRadius: 4, cursor: 'pointer',
                  font: '500 11px/1 var(--font-sans)', color: '#1d4ed8',
                  background: '#eff6ff', border: '1px solid #bfdbfe',
                }}
              >今日</button>
            )}
          </div>
        </div>
      </div>

      {/* ── サマリーバー ──────────────────────────────────────────────── */}
      {!loading && summary && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 16,
          padding: '8px 14px',
          background: '#fff', border: '1px solid var(--ge-line)', borderRadius: 8,
        }}>
          {([
            { dot: '#22c55e', label: '正常退室',   count: summary.normal,            filter: 'normal' },
            { dot: '#ef4444', label: '未退室',      count: summary.unmatched_checkin, filter: 'unmatched_checkin' },
            { dot: '#f97316', label: '退室のみ',    count: summary.checkout_only,     filter: 'checkout_only' },
          ] as const).map(({ dot, label, count, filter }) => (
            <button
              key={filter}
              onClick={() => setFType(fType === filter ? '' : filter)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                padding: '3px 8px', borderRadius: 4,
                font: '400 12px/1 var(--font-sans)', color: 'var(--ge-ink-2)',
                background: fType === filter ? '#f1f5f9' : 'transparent',
                border: fType === filter ? '1px solid var(--ge-line)' : '1px solid transparent',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />
              {label}
              <strong style={{ color: 'var(--ge-ink)', font: '700 13px/1 var(--font-sans)' }}>{count}</strong>件
            </button>
          ))}
          <div style={{
            width: 1, height: 16, background: 'var(--ge-line)', flexShrink: 0,
          }} />
          <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--ge-ink-3)' }}>
            合計 <strong style={{ color: 'var(--ge-ink)' }}>{summary.total}</strong> 件
          </span>
          <span style={{ marginLeft: 'auto', font: '400 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)' }}>
            表示: {rows.length} 件
          </span>
        </div>
      )}

      {/* ── テーブル ──────────────────────────────────────────────────── */}
      {loading ? (
        <div style={{
          textAlign: 'center', padding: '48px 0',
          color: 'var(--ge-ink-4)', font: '400 13px/1 var(--font-sans)',
        }}>
          <div style={{
            display: 'inline-block', width: 20, height: 20,
            border: '2px solid var(--ge-line)', borderTop: '2px solid var(--ge-accent)',
            borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            marginRight: 8, verticalAlign: 'middle',
          }} />
          読み込み中...
        </div>
      ) : (
        <div style={{
          background: '#fff', border: '1px solid var(--ge-line)',
          borderRadius: 8, overflow: 'hidden', flex: 1,
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{ overflowX: 'auto', flex: 1, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                {/* ── ラベル行 ── */}
                <tr style={{ borderBottom: '1px solid var(--ge-line)' }}>
                  {([
                    { col: 'type' as SortCol,     label: '種別',     width: 80 },
                    { col: 'name' as SortCol,      label: '名前',     width: 100 },
                    { col: 'company' as SortCol,   label: '所属',     width: 140 },
                    { col: 'store' as SortCol,     label: '店舗',     width: 100 },
                    { col: 'checkin' as SortCol,   label: '入室時刻', width: 150 },
                    { col: 'checkout' as SortCol,  label: '退室時刻', width: 150 },
                  ]).map(({ col, label, width }) => (
                    <th
                      key={col}
                      onClick={() => handleSort(col)}
                      style={{ ...TH, cursor: 'pointer', width, minWidth: width }}
                    >
                      {label}
                      <SortIcon col={col} current={sortCol} dir={sortDir} />
                    </th>
                  ))}
                </tr>
                {/* ── フィルター行 ── */}
                <tr style={{ borderBottom: '2px solid var(--ge-line)' }}>
                  <th style={{ ...TH, background: '#fff', padding: '4px 6px' }}>
                    <select
                      value={fType}
                      onChange={e => setFType(e.target.value)}
                      style={FILTER_SELECT}
                    >
                      <option value="">すべて</option>
                      <option value="normal">✓ 正常</option>
                      <option value="unmatched_checkin">未退室</option>
                      <option value="checkout_only">退室のみ</option>
                    </select>
                  </th>
                  <th style={{ ...TH, background: '#fff', padding: '4px 6px' }}>
                    <input
                      value={fName}
                      onChange={e => setFName(e.target.value)}
                      placeholder="名前で絞込…"
                      style={FILTER_INPUT}
                    />
                  </th>
                  <th style={{ ...TH, background: '#fff', padding: '4px 6px' }}>
                    <input
                      value={fCompany}
                      onChange={e => setFCompany(e.target.value)}
                      placeholder="所属で絞込…"
                      style={FILTER_INPUT}
                    />
                  </th>
                  <th style={{ ...TH, background: '#fff', padding: '4px 6px' }}>
                    <select
                      value={fStore}
                      onChange={e => setFStore(e.target.value)}
                      style={FILTER_SELECT}
                    >
                      <option value="">すべての店舗</option>
                      {storeOptions.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </th>
                  <th style={{ ...TH, background: '#fff', padding: '4px 6px' }}>
                    <input
                      value={fCheckin}
                      onChange={e => setFCheckin(e.target.value)}
                      placeholder="例: 09"
                      style={FILTER_INPUT}
                    />
                  </th>
                  <th style={{ ...TH, background: '#fff', padding: '4px 6px' }}>
                    <input
                      value={fCheckout}
                      onChange={e => setFCheckout(e.target.value)}
                      placeholder="例: 18"
                      style={FILTER_INPUT}
                    />
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{
                      padding: '40px', textAlign: 'center',
                      color: 'var(--ge-ink-4)', font: '400 13px/1 var(--font-sans)',
                    }}>
                      {apiData ? '絞り込み条件に一致するデータがありません' : 'データなし'}
                    </td>
                  </tr>
                ) : rows.map(row => (
                  <tr
                    key={row.visitor_id}
                    style={rowStyle(row.mismatch_type)}
                  >
                    <td style={TD}><TypeBadge type={row.mismatch_type} /></td>
                    <td style={{ ...TD, font: '600 12px/1.3 var(--font-sans)', color: '#1e3a5f', whiteSpace: 'nowrap' }}>
                      {row.name}
                    </td>
                    <td style={TD}>
                      <div style={{ font: '500 12px/1.3 var(--font-sans)', color: 'var(--ge-ink)' }}>
                        {row.company}
                      </div>
                      {row.department && (
                        <div style={{ font: '400 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', marginTop: 2 }}>
                          {row.department}
                        </div>
                      )}
                    </td>
                    <td style={{ ...TD, color: 'var(--ge-ink-3)', whiteSpace: 'nowrap' }}>
                      {row.stores.join(' / ') || '—'}
                    </td>
                    <td style={TD}>
                      <TimeChips times={row.checkins} variant="in" />
                    </td>
                    <td style={TD}>
                      <TimeChips times={row.checkouts} variant="out" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* テーブルフッター: 凡例 */}
          <div style={{
            padding: '8px 14px', background: '#f8fafc',
            borderTop: '1px solid var(--ge-line)',
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          }}>
            {([
              { color: '#22c55e', label: '正常退室' },
              { color: '#ef4444', label: '未退室（入室記録あり・退室なし）' },
              { color: '#f97316', label: '退室のみ（入室記録なし）' },
            ]).map(({ color, label }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <div style={{ width: 12, height: 3, borderRadius: 2, background: color, flexShrink: 0 }} />
                <span style={{ font: '400 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        tbody tr:hover td { background: #f8fafc !important; }
      `}</style>
    </div>
  )
}
