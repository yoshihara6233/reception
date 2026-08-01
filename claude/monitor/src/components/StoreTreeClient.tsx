'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Siren } from 'lucide-react'
import { deriveEdgeStatus } from '@/lib/edge-status'

// Persist the tree scroll position across navigations. The tree is re-mounted
// on every /stores/[id] change (it lives in each page's AppShell, not a shared
// layout), which otherwise snaps it back to the top — making it impossible to
// pick a store near the one you just opened. Saving scrollTop to sessionStorage
// and restoring it on mount keeps the position.
const SCROLL_KEY = 'storeTree:scrollTop'

// GE Phase 2b: ブランドアクセントは藍に集約（grid/live=藍）。semantic は据え置き。
const STATUS_COLOR: Record<string, string> = {
  online:  '#2F7A4F',
  idle:    '#2F7A4F',
  grid:    '#2C4A7E',
  live:    '#2C4A7E',
  vod:     '#B5761A',
  error:   '#A3332B',
  offline: '#9ca3af',
}

interface StoreRow {
  id: string
  name: string
  area_code: string | null
  edge_devices: { status: string; last_seen_at: string | null }[] | null
}

/** TC3: last_seen 鮮度を真実源にツリードットの色を決める（監視中断=赤）。 */
function treeDotColor(dev: { status: string; last_seen_at: string | null } | undefined): string {
  const d = deriveEdgeStatus(dev?.status, dev?.last_seen_at)
  if (d.plane === 'interrupted') return '#A3332B'
  if (d.plane === 'stopped' || d.plane === 'unconfigured') return STATUS_COLOR.offline
  return STATUS_COLOR[d.mode ?? 'offline'] ?? STATUS_COLOR.offline
}

interface Group {
  area: string
  stores: StoreRow[]
}

export function TreeClient({
  groups,
  selectedId,
  alertStoreIds = [],
  alertGroups = [],
}: {
  groups: Group[]
  selectedId?: string
  alertStoreIds?: string[]
  /** 地震（Jアラート発令）単位のグループ。群発時に対象店舗を地震で絞る。 */
  alertGroups?: { key: string; label: string; storeIds: string[] }[]
}) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [alertFilter, setAlertFilter] = useState(false)
  const [quakeKey, setQuakeKey] = useState('all')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Restore saved scroll position on mount.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const saved = sessionStorage.getItem(SCROLL_KEY)
    if (saved !== null) el.scrollTop = Number(saved)
  }, [])

  const alertSet = useMemo(() => new Set(alertStoreIds), [alertStoreIds])

  // 地震絞り込み中は選択した地震の対象店舗だけを有効集合にする。
  const activeAlertSet = useMemo(() => {
    if (quakeKey === 'all') return alertSet
    const g = alertGroups.find((x) => x.key === quakeKey)
    return g ? new Set(g.storeIds) : alertSet
  }, [quakeKey, alertGroups, alertSet])

  const filtered = useMemo(() => {
    let base = groups

    // Alert filter: show only stores that received a BCP alert in the last 24 h
    if (alertFilter && activeAlertSet.size > 0) {
      base = base
        .map((g) => ({ ...g, stores: g.stores.filter((s) => activeAlertSet.has(s.id)) }))
        .filter((g) => g.stores.length > 0)
    }

    // Text search
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      base = base
        .map((g) => ({ ...g, stores: g.stores.filter((s) => s.name.toLowerCase().includes(q)) }))
        .filter((g) => g.stores.length > 0)
    }

    return base
  }, [groups, query, alertFilter, activeAlertSet])

  return (
    <>
      {/* BCP alert filter chip — visible only when there are recent alerts */}
      {alertSet.size > 0 && (
        <div className="border-b border-slate-200 px-2 py-1.5">
          <button
            type="button"
            onClick={() => { setAlertFilter((v) => !v); setQuakeKey('all') }}
            className={
              'flex w-full items-center gap-1.5 rounded px-2 py-1 text-[11px] font-semibold transition-colors ' +
              (alertFilter
                ? 'bg-red-600 text-white'
                : 'border border-red-300 bg-red-50 text-red-700 hover:bg-red-100')
            }
          >
            <Siren size={13} strokeWidth={1.5} aria-hidden />
            <span className="flex-1 text-left">直近アラート対象店舗</span>
            <span
              className={
                'rounded-full px-1.5 py-px text-[10px] font-bold ' +
                (alertFilter ? 'bg-white/30 text-white' : 'bg-red-200 text-red-800')
              }
            >
              {alertSet.size}
            </span>
          </button>

          {/* 群発時: どの地震（発令時刻・震度）の対象店舗かを選んで絞り込む */}
          {alertFilter && alertGroups.length >= 2 && (
            <select
              value={quakeKey}
              onChange={(e) => setQuakeKey(e.target.value)}
              aria-label="地震で絞り込み"
              className="mt-1.5 w-full rounded border border-red-200 bg-white px-2 py-1 text-[11px] text-slate-700 outline-none focus:border-red-400"
            >
              <option value="all">すべての地震（{alertSet.size} 店舗）</option>
              {alertGroups.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}（{g.storeIds.length} 店舗）
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="p-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="店舗名で絞り込み…"
          className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs outline-none focus:border-blue-400"
        />
      </div>
      <div
        ref={scrollRef}
        onScroll={(e) => sessionStorage.setItem(SCROLL_KEY, String(e.currentTarget.scrollTop))}
        className="min-h-0 flex-1 overflow-y-auto pb-3 text-xs"
      >
        {filtered.map((g) => {
          const isOpen = !collapsed[g.area]
          return (
            <div key={g.area}>
              <div
                onClick={() => setCollapsed((c) => ({ ...c, [g.area]: !c[g.area] }))}
                className="cursor-pointer px-3 py-1 font-bold text-slate-700 select-none"
              >
                {isOpen ? '▾' : '▸'} {g.area} <span className="text-slate-400">({g.stores.length})</span>
              </div>
              {isOpen &&
                g.stores.map((s) => {
                  const dotColor = treeDotColor(s.edge_devices?.[0])   // TC3: 派生色
                  const active = s.id === selectedId
                  return (
                    <Link
                      key={s.id}
                      href={`/stores/${s.id}`}
                      className={
                        'flex items-center gap-2 px-3 py-1 pl-7 ' +
                        (active
                          ? 'bg-blue-100 font-semibold text-blue-800'
                          : 'hover:bg-slate-100')
                      }
                    >
                      <span
                        className="block h-2 w-2 flex-shrink-0 rounded-full"
                        style={{ background: dotColor }}
                      />
                      <span className="flex-1 truncate">{s.name}</span>
                      {alertSet.has(s.id) && (
                        <Siren size={11} strokeWidth={1.5} className="flex-shrink-0 text-red-500" aria-label="直近24h以内にBCPアラート発令" />
                      )}
                    </Link>
                  )
                })}
            </div>
          )
        })}
      </div>
    </>
  )
}
