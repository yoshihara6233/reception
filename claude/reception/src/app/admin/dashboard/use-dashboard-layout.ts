'use client'

import { useState, useEffect, useCallback } from 'react'

export interface WidgetConfig {
  id: string
  label: string
  visible: boolean
}

const DEFAULT_WIDGETS: WidgetConfig[] = [
  { id: 'today_summary',   label: 'KPI サマリー（現在・本日・手荷物・長時間）', visible: true },
  { id: 'alerts',          label: 'アラートパネル',                             visible: true },
  { id: 'baggage_alerts',  label: '受付未監査',                                 visible: true },
  { id: 'trend_chart',     label: '推移グラフ',                                 visible: true },
  { id: 'store_ranking',   label: '店舗別ランキング',                           visible: true },
  { id: 'analytics',       label: '来訪分析（目的別・時間帯・曜日）',           visible: true },
  { id: 'recent_visits',   label: '直近の来訪履歴',                             visible: true },
]

const STORAGE_KEY = 'dashboard_layout_v1'

function loadLayout(): WidgetConfig[] {
  if (typeof window === 'undefined') return DEFAULT_WIDGETS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_WIDGETS
    const saved: WidgetConfig[] = JSON.parse(raw)
    // saved の順序を尊重しつつ、DEFAULT に存在しないIDを除外、新規追加を末尾に
    const savedIds = saved.map(w => w.id)
    const merged = saved.filter(w => DEFAULT_WIDGETS.some(d => d.id === w.id))
    DEFAULT_WIDGETS.forEach(d => {
      if (!savedIds.includes(d.id)) merged.push(d)
    })
    return merged
  } catch {
    return DEFAULT_WIDGETS
  }
}

export function useDashboardLayout() {
  const [widgets, setWidgets] = useState<WidgetConfig[]>(DEFAULT_WIDGETS)

  // ハイドレーション後に localStorage から読む
  useEffect(() => {
    setWidgets(loadLayout())
  }, [])

  const save = useCallback((next: WidgetConfig[]) => {
    setWidgets(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }, [])

  const toggleVisible = useCallback((id: string) => {
    setWidgets(prev => {
      const next = prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const reorder = useCallback((newOrder: WidgetConfig[]) => {
    save(newOrder)
  }, [save])

  const reset = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setWidgets(DEFAULT_WIDGETS)
  }, [])

  return { widgets, toggleVisible, reorder, reset }
}
