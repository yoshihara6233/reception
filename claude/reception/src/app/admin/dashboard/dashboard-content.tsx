'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { TodaySummary } from './widgets/today-summary'
import { AlertPanel } from './widgets/alert-panel'
import { BaggageAlerts } from './baggage-alerts'
import { TrendChart } from './widgets/trend-chart'
import { StoreRanking } from './widgets/store-ranking'
import { DashboardTable } from './dashboard-table'
import { PurposeHeatmap } from '@/app/admin/analytics/purpose-heatmap'
import { useDashboardLayout, type WidgetConfig } from './use-dashboard-layout'
import type { DashboardStats } from '@/app/api/v1/admin/dashboard/stats/route'

// ── 型 ───────────────────────────────────────────────────────────────────────

interface BaggageAlert {
  id: string; context: 'checkin' | 'checkout'; status: 'pending' | 'flagged'
  created_at: string; visit_id: string
  visits: { id: string; visitors: { company: string; name: string } | null } | null
}
interface RecentVisit {
  id: string; purpose: string; status: string; check_in_at: string
  visitors: { company: string; name: string } | null
}

const VISIBLE_WIDGETS = {
  store_ranking_visits: true, store_ranking_inspection_rate: true,
  store_ranking_pending: true, store_ranking_unmatch: true,
}

function Skeleton({ h }: { h?: number }) {
  return (
    <div style={{
      background: 'var(--ge-paper-2)',
      borderRadius: 6,
      height: h ?? 80,
      animation: 'pulse 1.5s cubic-bezier(0.4,0,0.6,1) infinite',
    }} />
  )
}

// ── ソータブルウィジェットシェル ────────────────────────────────────────────

function SortableWidget({
  widget,
  editMode,
  onToggle,
  children,
}: {
  widget: WidgetConfig
  editMode: boolean
  onToggle: (id: string) => void
  children: React.ReactNode
}) {
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: widget.id, disabled: !editMode })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
  }

  if (!editMode) {
    // 通常モード: 非表示ウィジェットはスキップ（呼び出し側でフィルタ済み）
    return <div>{children}</div>
  }

  return (
    <div ref={setNodeRef} style={style} className="relative">
      {/* 編集バー */}
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-t-xl border-x border-t text-xs font-medium select-none ${
          widget.visible
            ? 'bg-[var(--ge-accent)]/8 border-[var(--ge-accent)]/25 text-[var(--ge-accent)]'
            : 'bg-gray-100 border-gray-200 text-gray-400'
        }`}
      >
        {/* ドラッグハンドル */}
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 -m-1 rounded hover:bg-black/5 touch-none"
          title="ドラッグして並び替え"
          tabIndex={-1}
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <circle cx="7" cy="5"  r="1.4"/><circle cx="13" cy="5"  r="1.4"/>
            <circle cx="7" cy="10" r="1.4"/><circle cx="13" cy="10" r="1.4"/>
            <circle cx="7" cy="15" r="1.4"/><circle cx="13" cy="15" r="1.4"/>
          </svg>
        </button>

        <span className="flex-1 truncate">{widget.label}</span>

        {/* ON/OFF トグル */}
        <button
          onClick={() => onToggle(widget.id)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0 ${
            widget.visible ? 'bg-[var(--ge-accent)]' : 'bg-gray-300'
          }`}
          title={widget.visible ? '非表示にする' : '表示する'}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            widget.visible ? 'translate-x-4' : 'translate-x-0.5'
          }`} />
        </button>
      </div>

      {/* ウィジェット本体（非表示時はグレーオーバーレイ） */}
      <div className={`relative rounded-b-xl border-x border-b overflow-hidden ${
        widget.visible ? 'border-[var(--ge-accent)]/25' : 'border-gray-200'
      }`}>
        <div className={widget.visible ? '' : 'opacity-30 pointer-events-none select-none'}>
          {children}
        </div>
        {!widget.visible && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50">
            <span className="px-3 py-1 bg-gray-200 text-gray-500 text-xs font-semibold rounded-full">
              非表示
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── メインコンポーネント ────────────────────────────────────────────────────

export function DashboardContent() {
  const { widgets, toggleVisible, reorder, reset } = useDashboardLayout()
  const [editMode, setEditMode] = useState(false)

  const [stats,         setStats]         = useState<DashboardStats | null>(null)
  const [baggageAlerts, setBaggageAlerts] = useState<BaggageAlert[]>([])
  const [recentVisits,  setRecentVisits]  = useState<RecentVisit[]>([])
  const [rankPeriod,    setRankPeriod]    = useState('today')
  const [loading,       setLoading]       = useState(true)

  // ── データ取得 ─────────────────────────────────────────────────────────────
  const fetchStats = useCallback(async (period: string) => {
    try {
      const res = await fetch(`/api/v1/admin/dashboard/stats?period=${period}`)
      if (res.ok) setStats(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void fetchStats(rankPeriod) }, [rankPeriod, fetchStats])

  useEffect(() => {
    const supabase = createClient()
    void supabase
      .from('baggage_declarations')
      .select('id, context, status, created_at, visit_id, visits(id, visitors(company, name))')
      .in('status', ['pending', 'flagged'])
      .order('created_at', { ascending: false })
      .limit(8)
      .then(({ data }) => setBaggageAlerts((data ?? []) as unknown as BaggageAlert[]))
  }, [])

  useEffect(() => {
    const supabase = createClient()
    void supabase
      .from('visits')
      .select('id, purpose, status, check_in_at, check_out_at, visitors(company, name)')
      .order('check_in_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setRecentVisits((data ?? []) as unknown as RecentVisit[]))
  }, [])

  // ── DnD ───────────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = widgets.findIndex(w => w.id === active.id)
    const newIdx = widgets.findIndex(w => w.id === over.id)
    reorder(arrayMove(widgets, oldIdx, newIdx))
  }

  // ── ウィジェット本体のレンダリング ─────────────────────────────────────────
  const renderWidgetBody = (id: string) => {
    if (!stats) return null
    switch (id) {
      case 'today_summary':
        return (
          <TodaySummary
            currentVisitors={stats.today.current_visitors}
            todayVisits={stats.today.today_visits}
            pendingBaggage={stats.today.pending_baggage}
            longStayCount={stats.today.long_stay_count}
            longStayVisitors={stats.today.long_stay_visitors}
          />
        )
      case 'alerts':         return <AlertPanel alerts={stats.alerts} />
      case 'baggage_alerts': return baggageAlerts.length > 0
        ? <BaggageAlerts alerts={baggageAlerts} />
        : <div style={{ padding: '12px 16px', font: '400 12px/1 var(--ge-font-jp)', color: 'var(--ge-ink-4)' }}>未審査・フラグの手荷物はありません</div>
      case 'trend_chart':    return <TrendChart />
      case 'store_ranking':
        return (
          <StoreRanking
            period={rankPeriod}
            onPeriodChange={(p) => { setRankPeriod(p); void fetchStats(p) }}
            rankings={stats.rankings}
            visibleWidgets={VISIBLE_WIDGETS}
          />
        )
      case 'analytics':      return <PurposeHeatmap />
      case 'recent_visits':  return <DashboardTable recentVisits={recentVisits} />
      default: return null
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
          {[...Array(4)].map((_, i) => <Skeleton key={i} h={88} />)}
        </div>
        <Skeleton h={56} /><Skeleton h={280} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {[...Array(4)].map((_, i) => <Skeleton key={i} h={180} />)}
        </div>
        <Skeleton h={240} />
      </div>
    )
  }

  if (!stats) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0', font: '400 13px/1 var(--ge-font-jp)', color: 'var(--ge-ink-4)' }}>
        データを読み込めませんでした
      </div>
    )
  }

  // 通常モードでは非表示ウィジェットをスキップ、編集モードでは全部表示
  const visibleInMode = editMode ? widgets : widgets.filter(w => w.visible)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      {/* ── ツールバー ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-2 mb-4">
        {editMode && (
          <button
            onClick={reset}
            className="text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 mr-2"
          >
            リセット
          </button>
        )}
        <button
          onClick={() => setEditMode(v => !v)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all shadow-sm ${
            editMode
              ? 'bg-[var(--ge-accent)] text-white border-[var(--ge-accent)] shadow-[var(--ge-accent)]/20'
              : 'bg-white text-gray-500 border-gray-200 hover:text-[var(--ge-accent)] hover:border-[var(--ge-accent)]/40'
          }`}
        >
          {editMode ? (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              編集を完了
            </>
          ) : (
            <>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              ウィジェットを編集
            </>
          )}
        </button>
      </div>

      {/* 編集モードヒント */}
      {editMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', marginBottom: 12,
          background: 'var(--ge-accent-soft)',
          border: '1px solid var(--ge-accent-line)',
          borderRadius: 4,
          font: '400 11px/1.4 var(--ge-font-jp)',
          color: 'var(--ge-accent-ink)',
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          バーをドラッグして並び替え、トグルで表示/非表示を切替できます
        </div>
      )}

      {/* ── ウィジェット一覧 ────────────────────────────────────────── */}
      <SortableContext
        items={widgets.map(w => w.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className={`space-y-${editMode ? '3' : '0'}`}>
          {visibleInMode.map(widget => (
            <SortableWidget
              key={widget.id}
              widget={widget}
              editMode={editMode}
              onToggle={toggleVisible}
            >
              {renderWidgetBody(widget.id)}
            </SortableWidget>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
