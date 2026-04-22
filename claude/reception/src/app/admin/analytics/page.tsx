'use client'

import { useEffect, useState } from 'react'
import { PurposeHeatmap } from './purpose-heatmap'
import { VisitsTrend } from './visits-trend'

interface Store { id: string; name: string }

export default function AnalyticsPage() {
  const [stores, setStores] = useState<Store[]>([])
  const [selectedStore, setSelectedStore] = useState<string>('all')

  useEffect(() => {
    fetch('/api/v1/admin/stores-list')
      .then(r => r.ok ? r.json() : { stores: [] })
      .then(d => setStores(d.stores ?? []))
      .catch(() => {})
  }, [])

  const storeId = selectedStore === 'all' ? undefined : selectedStore

  return (
    <div className="max-w-4xl">
      {/* ページヘッダー */}
      <div className="flex items-start justify-between mb-7 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1e3a5f]">アナリティクス</h1>
          <p className="text-sm text-gray-400 mt-0.5">来訪データのトレンド・パターン分析</p>
        </div>

        {/* 店舗フィルタ */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-gray-400 font-medium whitespace-nowrap">対象</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setSelectedStore('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                selectedStore === 'all'
                  ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-[#1e3a5f]'
              }`}
            >
              全店舗
            </button>
            {stores.map(store => (
              <button
                key={store.id}
                onClick={() => setSelectedStore(store.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
                  selectedStore === store.id
                    ? 'bg-[#1e3a5f] text-white border-[#1e3a5f]'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-[#1e3a5f]'
                }`}
              >
                {store.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-5">
        {/* 来訪トレンド（棒グラフ） */}
        <VisitsTrend storeId={storeId} />

        {/* 目的分布 + 曜日×時間帯ヒートマップ */}
        <PurposeHeatmap storeId={storeId} />
      </div>
    </div>
  )
}
