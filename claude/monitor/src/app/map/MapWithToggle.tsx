'use client'

/**
 * F26: /map ページ用ラッパ。StoreMap に alert-zoom トグルを乗せる。
 *
 * StoresDashboard 内の MapAlertView と同じトグル UI を /map ページにも
 * 提供する（ユーザは BottomNav の「地図」リンクから直接 /map に来ることが
 * 多いため）。
 */

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useLang } from '@/lib/i18n/context'
import type { EdgeStatus } from '@/lib/types/db'

const StoreMap = dynamic(() => import('./store-map'), { ssr: false })

type StoreRow = {
  id: string
  name: string
  address: string | null
  latitude: number
  longitude: number
  area_code: string | null
  edge_devices: { id: string; status: EdgeStatus; last_seen_at: string | null }[]
}

export function MapWithToggle({ stores, focusId }: { stores: StoreRow[]; focusId?: string | null }) {
  const { t } = useLang()
  const [zoomAlerts, setZoomAlerts] = useState(false)

  // /map ページに来るのは `.not('latitude', 'is', null)` を満たした店舗だけなので、
  // ここで返ってくる store は全て座標を持っている。よって geoAlertIds == alertIds。
  const geoAlertIds = stores
    .filter((s) => {
      const st = s.edge_devices?.[0]?.status
      return st === 'offline' || st === 'error'
    })
    .map((s) => s.id)
  const hasGeoAlerts = geoAlertIds.length > 0

  return (
    <div className="relative h-full w-full">
      <StoreMap stores={stores} highlightIds={zoomAlerts ? geoAlertIds : null} focusId={focusId} />

      <button
        onClick={() => setZoomAlerts((v) => !v)}
        className={[
          'absolute right-3 top-3 z-[1000] flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg transition-colors',
          zoomAlerts
            ? 'bg-slate-800 text-white hover:bg-slate-900'
            : hasGeoAlerts
              ? 'bg-red-500 text-white hover:bg-red-600'
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

      {/* F26.2: 押されたが地図に映せる対象が無い時の案内 */}
      {zoomAlerts && !hasGeoAlerts && (
        <div className="absolute left-1/2 top-16 z-[1000] -translate-x-1/2 rounded-lg bg-amber-50 px-4 py-2.5 text-xs text-amber-900 shadow-lg ring-1 ring-amber-200 dark:bg-amber-900/90 dark:text-amber-100 dark:ring-amber-700">
          ✓ {t.dashboard.alertZoomNoAlerts}
        </div>
      )}
    </div>
  )
}
