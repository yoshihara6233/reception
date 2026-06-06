'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

const STATUS_COLOR: Record<string, string> = {
  online:  '#22c55e',
  idle:    '#22c55e',
  grid:    '#3b82f6',
  live:    '#a855f7',
  vod:     '#f97316',
  error:   '#ef4444',
  offline: '#9ca3af',
}

interface StoreRow {
  id: string
  name: string
  area_code: string | null
  edge_devices: { status: string }[] | null
}

interface Group {
  area: string
  stores: StoreRow[]
}

export function TreeClient({
  groups,
  selectedId,
  alertStoreIds = [],
}: {
  groups: Group[]
  selectedId?: string
  alertStoreIds?: string[]
}) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [alertFilter, setAlertFilter] = useState(false)

  const alertSet = useMemo(() => new Set(alertStoreIds), [alertStoreIds])

  const filtered = useMemo(() => {
    let base = groups

    // Alert filter: show only stores that received a BCP alert in the last 24 h
    if (alertFilter && alertSet.size > 0) {
      base = base
        .map((g) => ({ ...g, stores: g.stores.filter((s) => alertSet.has(s.id)) }))
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
  }, [groups, query, alertFilter, alertSet])

  return (
    <>
      {/* BCP alert filter chip — visible only when there are recent alerts */}
      {alertSet.size > 0 && (
        <div className="border-b border-slate-200 px-2 py-1.5">
          <button
            type="button"
            onClick={() => setAlertFilter((v) => !v)}
            className={
              'flex w-full items-center gap-1.5 rounded px-2 py-1 text-[11px] font-semibold transition-colors ' +
              (alertFilter
                ? 'bg-red-600 text-white'
                : 'border border-red-300 bg-red-50 text-red-700 hover:bg-red-100')
            }
          >
            <span>🚨</span>
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
      <div className="min-h-0 flex-1 overflow-y-auto pb-3 text-xs">
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
                  const status = s.edge_devices?.[0]?.status ?? 'offline'
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
                        style={{ background: STATUS_COLOR[status] ?? STATUS_COLOR.offline }}
                      />
                      <span className="flex-1 truncate">{s.name}</span>
                      {alertSet.has(s.id) && (
                        <span className="flex-shrink-0 text-[9px] font-bold text-red-500" title="直近24h以内にBCPアラート発令">
                          🚨
                        </span>
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
