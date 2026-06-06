'use client'

/**
 * Mobile-first dual-screen dashboard:
 *   Tab 1: 店舗ビュー  — KPI strip + area-grouped store list
 *   Tab 2: 地図+アラート — Leaflet map + bottom-sheet alert panel
 *
 * All UI text comes from the i18n context — supports JA / EN / ZH / KO.
 */

import { useState, useMemo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { EdgeStatus } from '@/lib/types/db'
import { useLang } from '@/lib/i18n/context'

const StoreMap = dynamic(() => import('@/app/map/store-map'), {
  ssr: false,
  loading: () => {
    // Can't use hook inside dynamic loading fn — static spinner
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        …
      </div>
    )
  },
})

type EdgeDevice = {
  id: string
  status: EdgeStatus
  last_seen_at: string | null
}

export type StoreDashRow = {
  id: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  area_code: string | null
  edge_devices: EdgeDevice[]
}

// ─── Status badge styles ──────────────────────────────────────────────────────

const STATUS_BADGE: Record<EdgeStatus, string> = {
  offline: 'bg-slate-100 text-slate-500',
  idle:    'bg-emerald-100 text-emerald-700',
  grid:    'bg-blue-100 text-blue-700',
  live:    'bg-purple-100 text-purple-700',
  vod:     'bg-orange-100 text-orange-700',
  error:   'bg-red-100 text-red-600',
}

const STATUS_DOT: Record<EdgeStatus, string> = {
  offline: 'bg-slate-300',
  idle:    'bg-emerald-400',
  grid:    'bg-blue-500',
  live:    'bg-purple-500',
  vod:     'bg-orange-400',
  error:   'bg-red-500',
}

// ─── Relative time (uses translation strings) ─────────────────────────────────

function useRelativeTime() {
  const { t } = useLang()
  return function relativeTime(iso: string | null): string {
    if (!iso) return t.alert.unknownTime
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (diff < 60)   return t.alert.secsAgo(diff)
    if (diff < 3600) return t.alert.minsAgo(Math.floor(diff / 60))
    return t.alert.hoursAgo(Math.floor(diff / 3600))
  }
}

// ─── Root component ───────────────────────────────────────────────────────────

export function StoresDashboard({
  stores,
  alertStoreIds,
}: {
  stores: StoreDashRow[]
  /**
   * F27: server-side で集約した「直近アラート対象店舗」の ID 配列。
   * monitor_incidents / bcp_events / patrol_findings / edge offline-error
   * の union。未指定なら edge offline/error のみで判定する後方互換動作。
   */
  alertStoreIds?: string[]
}) {
  const { t }   = useLang()
  const [tab, setTab] = useState<'list' | 'map'>('list')

  const alertIdSet = useMemo(
    () => new Set(alertStoreIds ?? []),
    [alertStoreIds],
  )
  const hasAlertSignal = alertStoreIds !== undefined

  const alertStores = useMemo(
    () => stores.filter((s) =>
      hasAlertSignal
        ? alertIdSet.has(s.id)
        : (() => {
            const st = s.edge_devices?.[0]?.status
            return st === 'offline' || st === 'error'
          })(),
    ),
    [stores, alertIdSet, hasAlertSignal],
  )

  const kpis = useMemo(() => {
    let monitoring = 0, live = 0
    stores.forEach((s) => {
      const st = s.edge_devices?.[0]?.status
      if (st === 'grid')                       monitoring++
      else if (st === 'live')                  live++
    })
    return { total: stores.length, monitoring, live, alerts: alertStores.length }
  }, [stores, alertStores.length])

  const groups = useMemo(() => {
    const map = new Map<string, StoreDashRow[]>()
    stores.forEach((s) => {
      const area = s.area_code ?? t.workspace.unclassified
      if (!map.has(area)) map.set(area, [])
      map.get(area)!.push(s)
    })
    return [...map.entries()].map(([area, items]) => ({ area, items }))
  }, [stores, t])

  const mapStores = useMemo(
    () =>
      stores.filter((s) => s.latitude != null && s.longitude != null) as (StoreDashRow & {
        latitude: number
        longitude: number
      })[],
    [stores],
  )

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#F7F5F1]">
      {/* ── Tab switcher ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 border-b border-stone-200 bg-white px-3 py-2">
        <TabBtn active={tab === 'list'} onClick={() => setTab('list')}>
          {t.dashboard.storeView}
        </TabBtn>
        <TabBtn active={tab === 'map'} onClick={() => setTab('map')}>
          {t.dashboard.mapAlert}
          {kpis.alerts > 0 && (
            <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white leading-none">
              {kpis.alerts}
            </span>
          )}
        </TabBtn>
      </div>

      {/* ── Content ──────────────────────────────────────────────────────── */}
      {tab === 'list' ? (
        <ListView kpis={kpis} groups={groups} />
      ) : (
        <MapAlertView mapStores={mapStores} alertStores={alertStores} />
      )}
    </div>
  )
}

// ─── Tab button ───────────────────────────────────────────────────────────────

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={
        'flex items-center rounded-full px-4 py-1.5 text-xs font-semibold transition-colors ' +
        (active
          ? 'bg-[#2C4A7E] text-white'
          : 'text-slate-500 hover:bg-stone-100')
      }
    >
      {children}
    </button>
  )
}

// ─── Tab 1: Store list ────────────────────────────────────────────────────────

function ListView({
  kpis,
  groups,
}: {
  kpis: { total: number; monitoring: number; live: number; alerts: number }
  groups: { area: string; items: StoreDashRow[] }[]
}) {
  const { t } = useLang()

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* KPI strip */}
      <div className="grid grid-cols-4 divide-x divide-stone-200 border-b border-stone-200 bg-white">
        {[
          { label: t.kpi.total,      value: kpis.total,      cls: 'text-slate-800' },
          { label: t.kpi.monitoring, value: kpis.monitoring, cls: 'text-blue-600' },
          { label: t.kpi.live,       value: kpis.live,        cls: 'text-purple-600' },
          {
            label: t.kpi.alerts,
            value: kpis.alerts,
            cls: kpis.alerts > 0 ? 'text-red-500' : 'text-slate-400',
          },
        ].map((k) => (
          <div key={k.label} className="flex flex-col items-center py-2.5">
            <span className={`text-xl font-bold leading-none ${k.cls}`}>{k.value}</span>
            <span className="mt-0.5 text-[10px] text-slate-400">{k.label}</span>
          </div>
        ))}
      </div>

      {/* Area-grouped store list */}
      <div className="flex-1 overflow-y-auto pb-14 md:pb-0">
        {groups.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-slate-400">
            {t.dashboard.noStores}
          </div>
        ) : (
          groups.map(({ area, items }) => (
            <div key={area}>
              <div className="sticky top-0 z-10 flex items-baseline gap-2 bg-[#F7F5F1] px-4 py-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {area}
                </span>
                <span className="text-[11px] text-slate-400">
                  {items.length}{t.dashboard.countUnit}
                </span>
              </div>

              {items.map((s) => {
                const status = (s.edge_devices?.[0]?.status ?? 'offline') as EdgeStatus
                return (
                  <Link
                    key={s.id}
                    href={`/stores/${s.id}`}
                    className="flex items-center gap-3 border-b border-stone-100 bg-white px-4 py-3 hover:bg-stone-50 active:bg-stone-100"
                  >
                    <div className={`h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT[status]}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-800">{s.name}</p>
                      {s.address && (
                        <p className="truncate text-[11px] text-slate-400">{s.address}</p>
                      )}
                    </div>
                    <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_BADGE[status]}`}>
                      {t.status[status]}
                    </span>
                    <ChevronRight />
                  </Link>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Tab 2: Map + Alert ───────────────────────────────────────────────────────

function MapAlertView({
  mapStores,
  alertStores,
}: {
  mapStores: (StoreDashRow & { latitude: number; longitude: number })[]
  alertStores: StoreDashRow[]
}) {
  const { t }              = useLang()
  const relativeTime       = useRelativeTime()
  const [sheetOpen, setSheetOpen] = useState(true)
  // F26: alert-zoom toggle. When true, the map zooms to alert stores and
  // dims everything else. Defaults to OFF so the first paint still shows
  // the global picture.
  const [zoomAlerts, setZoomAlerts] = useState(false)

  // IDs of alert stores that also have geocoordinates (the only ones the
  // map can actually fit-bounds to).
  const geoAlertIds = alertStores
    .filter((s) => s.latitude != null && s.longitude != null)
    .map((s) => s.id)
  const hasGeoAlerts = geoAlertIds.length > 0

  return (
    <div className="relative flex-1 overflow-hidden">
      {/* Map */}
      <div className="h-full w-full">
        <StoreMap
          stores={mapStores as never}
          highlightIds={zoomAlerts ? geoAlertIds : null}
        />
      </div>

      {/* F26: alert-zoom toggle — top-right floating button.
          z-[1000] is required to win over Leaflet's panes (tile=200,
          marker=600, popup=700, control=1000).

          F26.2: 常に押せるようにする。座標が未設定でも disabled にせず、
          押された結果は下のバナーで案内する（disabled だと「壊れている」と
          誤解される）。 */}
      <button
        onClick={() => setZoomAlerts((v) => !v)}
        className={[
          'absolute right-3 top-3 z-[1000] flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg transition-colors',
          zoomAlerts
            ? 'bg-slate-800 text-white hover:bg-slate-900'
            : hasGeoAlerts
              ? 'bg-red-500 text-white hover:bg-red-600'
              : alertStores.length > 0
                ? 'bg-amber-500 text-white hover:bg-amber-600'
                : 'bg-slate-500 text-white hover:bg-slate-600',
        ].join(' ')}
      >
        {zoomAlerts ? t.dashboard.alertZoomOff : t.dashboard.alertZoomOn}
        {!zoomAlerts && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-white/20 px-1 text-[10px] font-bold leading-none">
            {geoAlertIds.length}
          </span>
        )}
      </button>

      {/* F26.2: 押された後、表示できる対象が無い時の案内バナー */}
      {zoomAlerts && !hasGeoAlerts && (
        <div className="absolute left-1/2 top-16 z-[1000] -translate-x-1/2 rounded-lg bg-amber-50 px-4 py-2.5 text-xs text-amber-900 shadow-lg ring-1 ring-amber-200 dark:bg-amber-900/90 dark:text-amber-100 dark:ring-amber-700">
          {alertStores.length > 0
            ? <>⚠ {t.dashboard.alertZoomNoGeo(alertStores.length)}</>
            : <>✓ {t.dashboard.alertZoomNoAlerts}</>}
        </div>
      )}

      {/* Alert bottom sheet — sits above BottomNav on mobile */}
      <div
        className={[
          // z-[1000] same reason as the alert-zoom button (Leaflet panes).
          'absolute bottom-14 left-0 right-0 z-[1000] rounded-t-2xl bg-white shadow-2xl transition-transform duration-300',
          'md:bottom-0',
          sheetOpen ? 'translate-y-0' : 'translate-y-[calc(100%-52px)]',
        ].join(' ')}
      >
        {/* Handle + header */}
        <button
          onClick={() => setSheetOpen((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-3.5"
        >
          <div className="flex items-center gap-2">
            <span
              className={[
                'h-2 w-2 rounded-full',
                alertStores.length > 0 ? 'animate-pulse bg-red-500' : 'bg-emerald-400',
              ].join(' ')}
            />
            <span className="text-sm font-semibold text-slate-800">
              {alertStores.length > 0
                ? t.dashboard.alertsN(alertStores.length)
                : t.dashboard.noAlerts}
            </span>
          </div>
          <svg
            width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`transition-transform duration-300 ${sheetOpen ? '' : 'rotate-180'}`}
          >
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>

        {/* Alert list */}
        <div className="max-h-52 overflow-y-auto border-t border-stone-100">
          {alertStores.length === 0 ? (
            <div className="px-4 py-5 text-center text-sm text-slate-400">
              {t.dashboard.allGood}
            </div>
          ) : (
            alertStores.map((s) => {
              const dev    = s.edge_devices?.[0]
              const isErr  = dev?.status === 'error'
              return (
                <Link
                  key={s.id}
                  href={`/stores/${s.id}`}
                  className="flex items-center gap-3 border-b border-stone-100 px-4 py-3 hover:bg-stone-50 active:bg-stone-100"
                >
                  <div
                    className={[
                      'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full',
                      isErr ? 'bg-red-100' : 'bg-slate-100',
                    ].join(' ')}
                  >
                    {isErr ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="12" y1="8" x2="12" y2="12"/>
                        <line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="1" y1="1" x2="23" y2="23"/>
                        <path d="M16.72 11.06A10.94 10.94 0 0119 12.55"/>
                        <path d="M5 12.55a10.94 10.94 0 015.17-2.39"/>
                        <path d="M10.71 5.05A16 16 0 0122.56 9"/>
                        <path d="M1.42 9a15.91 15.91 0 014.7-2.88"/>
                        <path d="M8.53 16.11a6 6 0 016.95 0"/>
                        <line x1="12" y1="20" x2="12.01" y2="20"/>
                      </svg>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-800">{s.name}</p>
                    <p className="text-[11px] text-slate-400">
                      {isErr ? t.alert.edgeError : t.alert.edgeOffline}
                      {dev?.last_seen_at && (
                        <> · {relativeTime(dev.last_seen_at)}</>
                      )}
                    </p>
                  </div>

                  <ChevronRight />
                </Link>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Shared ───────────────────────────────────────────────────────────────────

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
}
