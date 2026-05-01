'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSiteConfig } from '@/lib/site-config'

// ── 型 ────────────────────────────────────────────────────────────────────────

type BaggageItem = {
  id: string
  context: 'checkin' | 'checkout'
  declaration_text: string
  status: string
  inspection_mode: string | null   // 'video' | 'photo' | null
  photoContentsUrl: string | null
  photoEmptyUrl: string | null
  facePhotoUrl: string | null
  cardPhotoUrl: string | null
  staff_notes: string | null
  reviewed_at: string | null
  created_at: string
  visits: {
    id: string
    check_in_at: string
    purpose: string | null
    stores: { name: string } | null
    visitors: { name: string; company: string } | null
  } | null
}

type PendingDate = { date: string; count: number }

// ── ヘルパー ──────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('sv-SE')
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = todayStr()
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toLocaleDateString('sv-SE')
  const label = d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short' })
  if (dateStr === today) return `今日 (${label})`
  if (dateStr === yesterdayStr) return `昨日 (${label})`
  return label
}

const STATUS_BADGE: Record<string, { label: string; cls: string; dot: string }> = {
  pending:  { label: '審査待ち',   cls: 'bg-yellow-100 text-yellow-800',     dot: 'bg-yellow-400' },
  flagged:  { label: '🚩 フラグ',  cls: 'bg-red-100 text-red-800',           dot: 'bg-red-500' },
  cleared:  { label: '✓ 問題なし', cls: 'bg-emerald-100 text-emerald-800',   dot: 'bg-emerald-400' },
  approved: { label: '✓ 承認',     cls: 'bg-blue-100 text-blue-800',         dot: 'bg-blue-400' },
  rejected: { label: '却下',       cls: 'bg-gray-100 text-gray-500',         dot: 'bg-gray-400' },
}

// ── モックカメラデータ ──────────────────────────────────────────────────────

const MOCK_CAMERAS = [
  { slot: 1, label: '受付カウンター',   model: 'WV-S1536LN' },
  { slot: 2, label: '手荷物検査デスク', model: 'WV-X2531LN' },
]
const MOCK_DURATION = 600
const MOCK_EVENTS = [
  { t: 15,  label: '入室', color: '#22c55e' },
  { t: 120, label: '申告', color: '#3b82f6' },
  { t: 180, label: '撮影', color: '#f59e0b' },
  { t: 420, label: '審査', color: '#8b5cf6' },
  { t: 560, label: '退室', color: '#6b7280' },
]

// ── インラインカメラビューア ───────────────────────────────────────────────

function CameraViewer({ baggageId }: { baggageId: string }) {
  const [playing, setPlaying]   = useState(false)
  const [position, setPosition] = useState(120)
  const [speed, setSpeed]       = useState(1)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (playing) {
      timerRef.current = setInterval(() => {
        setPosition(p => {
          if (p >= MOCK_DURATION) { setPlaying(false); return MOCK_DURATION }
          return p + speed
        })
      }, 1000)
    } else {
      if (timerRef.current) clearInterval(timerRef.current)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [playing, speed])

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  return (
    <div className="flex flex-col h-full bg-gray-950 select-none">

      {/* 2カメラグリッド */}
      <div className="flex-1 grid grid-cols-2 gap-px bg-gray-800 min-h-0">
        {MOCK_CAMERAS.map(cam => (
          <div key={cam.slot} className="relative bg-gray-900 flex items-center justify-center overflow-hidden">
            {/* グリッドオーバーレイ */}
            <div className="absolute inset-0 opacity-[0.06]" style={{
              backgroundImage: 'linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)',
              backgroundSize: '60px 60px',
            }} />
            {/* ラベル */}
            <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 z-10">
              <div className={`w-1.5 h-1.5 rounded-full ${playing ? 'bg-red-500 animate-pulse' : 'bg-gray-600'}`} />
              <span className="text-white/60 text-xs font-mono">{cam.label}</span>
            </div>
            <div className="absolute bottom-2 right-2.5 text-white/20 text-[10px] font-mono">{cam.model}</div>
            {/* 再生ボタン */}
            {!playing && (
              <button
                onClick={() => setPlaying(true)}
                className="w-14 h-14 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 flex items-center justify-center transition-colors z-10"
              >
                <span className="text-white text-2xl ml-1">▶</span>
              </button>
            )}
          </div>
        ))}
      </div>

      {/* タイムライン */}
      <div className="bg-gray-900 px-4 pt-3 pb-1.5 border-t border-gray-800">
        {/* イベントマーカー */}
        <div className="relative h-5 mb-1">
          {MOCK_EVENTS.map(ev => (
            <button
              key={ev.t}
              onClick={() => setPosition(ev.t)}
              title={ev.label}
              className="absolute -translate-x-1/2 flex flex-col items-center gap-0.5 group"
              style={{ left: `${(ev.t / MOCK_DURATION) * 100}%` }}
            >
              <span className="text-[9px] text-white/30 group-hover:text-white/60 whitespace-nowrap transition-colors">
                {ev.label}
              </span>
              <div className="w-1.5 h-1.5 rounded-full ring-1 ring-black/20" style={{ backgroundColor: ev.color }} />
            </button>
          ))}
        </div>

        {/* シークバー */}
        <div className="relative">
          <input
            type="range" min={0} max={MOCK_DURATION} value={position}
            onChange={e => setPosition(Number(e.target.value))}
            className="w-full h-1.5 cursor-pointer accent-[var(--ge-accent)]"
          />
        </div>

        {/* コントロール */}
        <div className="flex items-center gap-1.5 mt-2 pb-1">
          <button
            onClick={() => setPosition(p => Math.max(0, p - 10))}
            className="text-white/40 hover:text-white text-xs px-2 py-1 rounded hover:bg-white/10 transition-colors"
          >−10s</button>
          <button
            onClick={() => setPlaying(p => !p)}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center text-sm transition-colors"
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button
            onClick={() => setPosition(p => Math.min(MOCK_DURATION, p + 10))}
            className="text-white/40 hover:text-white text-xs px-2 py-1 rounded hover:bg-white/10 transition-colors"
          >+10s</button>
          <span className="text-white/40 text-xs font-mono ml-2">
            {fmt(position)} / {fmt(MOCK_DURATION)}
          </span>
          <div className="ml-auto flex gap-1">
            {[0.5, 1, 2, 4].map(s => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
                  speed === s
                    ? 'bg-white/20 text-white'
                    : 'text-white/30 hover:text-white hover:bg-white/10'
                }`}
              >×{s}</button>
            ))}
          </div>
        </div>
      </div>

      {/* 下部アクションバー */}
      <div className="bg-gray-900 border-t border-gray-800/50 px-4 py-2 flex items-center gap-1">
        <button className="text-xs text-white/30 hover:text-white/60 px-2 py-1 rounded hover:bg-white/10 transition-colors">
          📥 MP4
        </button>
        <button className="text-xs text-white/30 hover:text-white/60 px-2 py-1 rounded hover:bg-white/10 transition-colors">
          📎 フレーム添付
        </button>
        <button className="text-xs text-white/30 hover:text-white/60 px-2 py-1 rounded hover:bg-white/10 transition-colors">
          🔖 ブックマーク
        </button>
        <Link
          href={`/admin/baggage/${baggageId}/recording`}
          target="_blank"
          className="ml-auto text-xs text-[var(--ge-accent)]/50 hover:text-[var(--ge-accent)] transition-colors"
        >
          別画面で開く ↗
        </Link>
      </div>
    </div>
  )
}

// ── 写真ビューア ──────────────────────────────────────────────────────────────

function PhotoViewer({
  photoContentsUrl,
  photoEmptyUrl,
}: {
  photoContentsUrl: string | null
  photoEmptyUrl: string | null
}) {
  return (
    <div className="flex flex-col h-full bg-gray-950">
      <div className="flex-1 grid grid-cols-2 gap-px bg-gray-800 min-h-0 overflow-hidden">
        {[
          { url: photoContentsUrl, icon: '📦', label: '中身の写真' },
          { url: photoEmptyUrl,    icon: '👜', label: '空バッグ内部' },
        ].map(({ url, icon, label }) => (
          <div key={label} className="flex flex-col bg-gray-900 overflow-hidden">
            <div className="flex items-center gap-1.5 px-3 py-2 bg-black/30 flex-shrink-0">
              <span className="text-xs text-white/60">{icon} {label}</span>
              {!url && <span className="text-[10px] text-white/30 ml-1">（なし）</span>}
            </div>
            <div className="flex-1 flex items-center justify-center overflow-hidden p-2">
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={label} className="max-w-full max-h-full object-contain rounded" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-gray-600">
                  <span className="text-5xl opacity-20">{icon}</span>
                  <p className="text-xs opacity-30">写真なし</p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="bg-gray-900 border-t border-gray-800 px-4 py-2.5 flex items-center">
        <span className="text-xs text-white/25">📷 写真モード</span>
      </div>
    </div>
  )
}

// ── フェーズ1: 日付選択画面 ──────────────────────────────────────────────────

function SelectPhase({
  onStart,
}: {
  onStart: (date: string, includeReviewed: boolean) => void
}) {
  const router = useRouter()
  const [selectedDate, setSelectedDate]       = useState(todayStr())
  const [pendingDates, setPendingDates]       = useState<PendingDate[]>([])
  const [loadingDates, setLoadingDates]       = useState(true)
  const [includeReviewed, setIncludeReviewed] = useState(false)
  const [totalCount, setTotalCount]           = useState<number | null>(null)
  const [loadingTotal, setLoadingTotal]       = useState(false)

  useEffect(() => {
    fetch('/api/v1/admin/baggage-pending-dates?days=30')
      .then(r => r.json())
      .then(d => setPendingDates(d.dates ?? []))
      .catch(() => {})
      .finally(() => setLoadingDates(false))
  }, [])

  useEffect(() => {
    if (!includeReviewed || !selectedDate) { setTotalCount(null); return }
    setLoadingTotal(true)
    const params = new URLSearchParams({ status: 'all', dateFrom: selectedDate, dateTo: selectedDate, page: '1' })
    fetch(`/api/v1/admin/baggage-list?${params}`)
      .then(r => r.json())
      .then(d => setTotalCount(d.total ?? 0))
      .catch(() => setTotalCount(null))
      .finally(() => setLoadingTotal(false))
  }, [includeReviewed, selectedDate])

  const pendingMap   = Object.fromEntries(pendingDates.map(d => [d.date, d.count]))
  const pendingCount = pendingMap[selectedDate] ?? 0
  const totalPending = pendingDates.reduce((s, d) => s + d.count, 0)

  const canStart = includeReviewed
    ? (totalCount !== null && totalCount > 0)
    : pendingCount > 0

  const buttonLabel = (() => {
    if (loadingTotal) return '件数を確認中...'
    if (includeReviewed) {
      if (totalCount === null) return '件数を確認中...'
      if (totalCount === 0) return 'この日の手荷物申告はありません'
      return `${totalCount}件を再確認（実施済み含む）`
    }
    return pendingCount > 0 ? `${pendingCount}件のレビューを開始` : '審査待ちの件数はありません'
  })()

  return (
    <div className="max-w-xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push('/admin/visits')}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          ← 受付履歴
        </button>
        <h1 className="text-2xl font-bold text-[#1e3a5f]">日次レビュー</h1>
      </div>

      {!loadingDates && totalPending > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 mb-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-amber-600 font-semibold text-sm">⚠ 未実施の審査があります</span>
            <span className="ml-auto text-xs text-amber-500">合計 {totalPending} 件</span>
          </div>
          <div className="space-y-1.5">
            {pendingDates.map(({ date, count }) => (
              <button
                key={date}
                onClick={() => setSelectedDate(date)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm transition-colors ${
                  selectedDate === date
                    ? 'bg-amber-200 text-amber-900 font-medium'
                    : 'bg-white hover:bg-amber-100 text-amber-800'
                }`}
              >
                <span>{formatDate(date)}</span>
                <span className="px-2 py-0.5 bg-amber-400 text-white text-xs font-bold rounded-full">
                  {count}件
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!loadingDates && totalPending === 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl px-5 py-4 mb-5 flex items-center gap-2">
          <span className="text-emerald-600 text-sm font-medium">✅ 過去30日間の未実施審査はありません</span>
        </div>
      )}

      {loadingDates && (
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-5">
          <div className="w-4 h-4 border-2 border-gray-200 border-t-[var(--ge-accent)] rounded-full animate-spin" />
          未実施日を確認中...
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm p-5">
        <p className="text-sm font-semibold text-[var(--ge-accent)] mb-3">レビュー対象日を選択</p>
        <div className="flex items-center gap-3 mb-4">
          <input
            type="date"
            value={selectedDate}
            max={todayStr()}
            onChange={e => setSelectedDate(e.target.value)}
            className="flex-1 px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]/30"
          />
          <button
            onClick={() => setSelectedDate(todayStr())}
            className={`px-3 py-2.5 text-xs rounded-xl border transition-colors ${
              selectedDate === todayStr()
                ? 'bg-[var(--ge-accent)] text-white border-[var(--ge-accent)]'
                : 'border-gray-200 text-gray-500 hover:border-[var(--ge-accent)] hover:text-[var(--ge-accent)]'
            }`}
          >
            今日
          </button>
        </div>

        <div className={`rounded-xl px-4 py-3 mb-4 ${
          includeReviewed ? 'bg-blue-50' : pendingCount > 0 ? 'bg-amber-50' : 'bg-gray-50'
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">{formatDate(selectedDate)} の審査待ち</span>
            <span className={`text-lg font-bold ${pendingCount > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
              {pendingCount} 件
            </span>
          </div>
          {includeReviewed && (
            <div className="flex items-center justify-between mt-1 pt-1 border-t border-blue-100">
              <span className="text-xs text-blue-600">実施済みを含む合計</span>
              <span className="text-sm font-semibold text-blue-700">
                {loadingTotal ? '...' : (totalCount ?? '—')} 件
              </span>
            </div>
          )}
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer mb-4 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
          <input
            type="checkbox"
            checked={includeReviewed}
            onChange={e => setIncludeReviewed(e.target.checked)}
            className="w-4 h-4 rounded accent-[var(--ge-accent)]"
          />
          <div>
            <p className="text-sm font-medium text-gray-700">実施済みを含む</p>
            <p className="text-xs text-gray-400">問題なし・フラグ済みのアイテムも表示して再確認できます</p>
          </div>
        </label>

        <button
          onClick={() => onStart(selectedDate, includeReviewed)}
          disabled={!canStart || loadingTotal}
          className="w-full py-3 bg-[var(--ge-accent)] text-white font-semibold rounded-xl
                     hover:bg-[var(--ge-accent)]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  )
}

// ── フェーズ2: 3カラムレビューワークスペース ──────────────────────────────────

function ReviewPhase({
  date,
  includeReviewed,
  onBack,
  onComplete,
}: {
  date: string
  includeReviewed: boolean
  onBack: () => void
  onComplete: (count: number) => void
}) {
  const [items, setItems]             = useState<BaggageItem[]>([])
  const [index, setIndex]             = useState(0)
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [done, setDone]               = useState(false)
  const [actionCount, setActionCount] = useState(0)
  const [note, setNote]               = useState('')
  const [showNote, setShowNote]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        status:   includeReviewed ? 'all' : 'pending',
        dateFrom: date,
        dateTo:   date,
        sortDir:  'asc',
        page:     '1',
      })
      const res  = await fetch(`/api/v1/admin/baggage-list?${params}`)
      const data = await res.json()
      setItems(data.declarations ?? [])
      setIndex(0)
      setActionCount(0)
      setDone(false)
    } finally {
      setLoading(false)
    }
  }, [date, includeReviewed])

  useEffect(() => { load() }, [load])

  // キーボードショートカット
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
      if (saving || done) return
      if (e.key === '1') handleAction('cleared')
      if (e.key === '2') handleAction('flagged')
      if (e.key === 'ArrowRight' || e.key === 's') handleSkip()
      if (e.key === 'ArrowLeft'  || e.key === 'a') handlePrev()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, done, index, items])

  const handleAction = async (status: 'cleared' | 'flagged') => {
    if (saving || items.length === 0 || !items[index]) return
    const item = items[index]
    setSaving(true)
    try {
      await fetch(`/api/v1/admin/baggage/${item.id}/review`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status, staff_notes: note || undefined }),
      })
      setItems(prev => prev.map((it, i) =>
        i === index
          ? { ...it, status, staff_notes: note || it.staff_notes, reviewed_at: new Date().toISOString() }
          : it
      ))
      const newCount = actionCount + 1
      setActionCount(newCount)
      setNote('')
      setShowNote(false)
      if (index + 1 >= items.length) {
        setDone(true)
        onComplete(newCount)
      } else {
        setIndex(i => i + 1)
      }
    } finally {
      setSaving(false)
    }
  }

  const handleSkip = () => {
    if (index + 1 >= items.length) return
    setIndex(i => i + 1)
    setNote('')
    setShowNote(false)
  }

  const handlePrev = () => {
    if (index === 0) return
    setIndex(i => i - 1)
    setNote('')
    setShowNote(false)
  }

  // ローディング
  if (loading) {
    return (
      <div className="flex items-center justify-center h-80">
        <div className="w-6 h-6 border-2 border-[var(--ge-accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // 完了 / 0件
  if (done || items.length === 0) {
    return (
      <div className="max-w-xl mx-auto text-center py-20">
        <div className="text-6xl mb-4">{items.length === 0 ? '📭' : '✅'}</div>
        <h2 className="text-xl font-bold text-[var(--ge-accent)] mb-2">
          {items.length === 0 ? 'この日の対象はありません' : 'レビュー完了！'}
        </h2>
        <p className="text-gray-500 text-sm mb-2">{formatDate(date)}</p>
        {items.length > 0 && (
          <p className="text-gray-500 text-sm mb-8">{actionCount} 件のレビューを完了しました</p>
        )}
        <div className="flex gap-3 justify-center mt-8">
          <button
            onClick={onBack}
            className="px-5 py-2.5 border border-[var(--ge-accent)] text-[var(--ge-accent)] text-sm rounded-xl
                       hover:bg-[var(--ge-accent)] hover:text-white transition-colors"
          >
            別の日を選択
          </button>
          <Link
            href="/admin/visits"
            className="px-5 py-2.5 bg-[var(--ge-accent)] text-white text-sm rounded-xl hover:bg-[var(--ge-accent)]/90 transition-colors"
          >
            受付履歴に戻る
          </Link>
        </div>
      </div>
    )
  }

  const item       = items[index]
  const visitor    = item.visits?.visitors
  const store      = item.visits?.stores
  const facePhotoUrl = item.facePhotoUrl
  const cardPhotoUrl = item.cardPhotoUrl
  const checkIn = item.visits?.check_in_at
    ? new Date(item.visits.check_in_at).toLocaleString('ja-JP', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '—'
  const declTime = new Date(item.created_at).toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const alreadyReviewed = item.status !== 'pending'
  const badge = STATUS_BADGE[item.status]
  const isVideo = item.inspection_mode === 'video'

  return (
    // -mx-8 -mt-[calc(52px+...)] で全幅に広げる
    <div className="-mx-8 flex flex-col" style={{ height: 'calc(100vh - 52px)' }}>

      {/* ワークスペースヘッダー */}
      <div className="flex items-center gap-3 px-6 py-2.5 bg-white border-b border-gray-200 flex-shrink-0">
        <button
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
        >
          ← 日付選択
        </button>
        <span className="text-gray-300">|</span>
        <span className="text-sm font-semibold text-[#1e3a5f]">{formatDate(date)}</span>
        {includeReviewed && (
          <span className="px-2 py-0.5 bg-blue-50 text-blue-600 border border-blue-200 text-xs rounded-full font-medium">
            再確認モード
          </span>
        )}
        <span className="text-xs text-gray-400 ml-1">{items.length}件</span>
        <span className="text-xs text-gray-300">·</span>
        <span className="text-xs text-gray-400">操作済み {actionCount}件</span>

        {/* プログレスバー */}
        <div className="flex-1 mx-4 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--ge-accent)] rounded-full transition-all duration-300"
            style={{ width: `${(actionCount / items.length) * 100}%` }}
          />
        </div>

        <span className="text-xs text-gray-400">{index + 1} / {items.length}</span>
        <p className="text-xs text-gray-300">キー: [1] 問題なし [2] フラグ [A/S] 前後</p>
      </div>

      {/* 3カラム本体 */}
      <div className="flex flex-1 min-h-0">

        {/* ── LEFT: アイテムキュー ────────────────────────────────────────── */}
        <div className="w-52 flex-shrink-0 border-r border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex-shrink-0">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">審査キュー</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {items.map((it, i) => {
              const b = STATUS_BADGE[it.status]
              const v = it.visits?.visitors
              const isActive = i === index
              return (
                <button
                  key={it.id}
                  onClick={() => { setIndex(i); setNote(''); setShowNote(false) }}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
                    isActive ? 'bg-[var(--ge-accent)]/5 border-l-2 border-l-[var(--ge-accent)]' : 'border-l-2 border-l-transparent'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${b?.dot ?? 'bg-gray-300'}`} />
                    <span className="text-xs font-medium text-gray-800 truncate">{v?.name ?? '—'}</span>
                  </div>
                  <p className="text-[11px] text-gray-400 truncate pl-3">{v?.company ?? ''}</p>
                  <div className="flex items-center gap-1 mt-1 pl-3">
                    {b && it.status !== 'pending' && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${b.cls}`}>{b.label}</span>
                    )}
                    <span className="text-[10px] text-gray-300 ml-auto">
                      {it.inspection_mode === 'video' ? '📹' : '📷'}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── CENTER: カメラ / 写真 ────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {isVideo ? (
            <CameraViewer baggageId={item.id} />
          ) : (
            <PhotoViewer
              photoContentsUrl={item.photoContentsUrl}
              photoEmptyUrl={item.photoEmptyUrl}
            />
          )}
        </div>

        {/* ── RIGHT: 訪問者情報 + 審査 ─────────────────────────────────────── */}
        <div className="w-72 flex-shrink-0 border-l border-gray-200 bg-white flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

            {/* バッジ行 */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {alreadyReviewed && badge && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`}>
                  {badge.label}
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                item.context === 'checkin'
                  ? 'bg-purple-50 text-purple-700 border-purple-200'
                  : 'bg-orange-50 text-orange-700 border-orange-200'
              }`}>
                {item.context === 'checkin' ? '入室時' : '退室時'}
              </span>
              {isVideo && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">動画</span>
              )}
              {store && (
                <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">{store.name}</span>
              )}
            </div>

            {/* 顔写真 + 名刺写真 */}
            {(facePhotoUrl || cardPhotoUrl) && (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { url: facePhotoUrl, icon: '👤', label: '顔写真' },
                  { url: cardPhotoUrl, icon: '🪪', label: '名刺' },
                ].map(({ url, icon, label }) => (
                  <div key={label} className="flex flex-col bg-gray-50 rounded-xl overflow-hidden border border-gray-100">
                    <div className="flex items-center gap-1 px-2 py-1 bg-gray-100 flex-shrink-0">
                      <span className="text-[10px] text-gray-500">{icon} {label}</span>
                      {!url && <span className="text-[10px] text-gray-400 ml-auto">なし</span>}
                    </div>
                    <div className="aspect-[3/4] flex items-center justify-center overflow-hidden bg-gray-50">
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt={label}
                          className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => window.open(url, '_blank')}
                        />
                      ) : (
                        <span className="text-3xl opacity-10">{icon}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 顔・名刺写真なし（未登録） */}
            {!facePhotoUrl && !cardPhotoUrl && (
              <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2.5 border border-gray-100">
                <span className="text-gray-300 text-lg">👤</span>
                <div>
                  <p className="text-xs text-gray-400 font-medium">顔・名刺写真なし</p>
                  <p className="text-[11px] text-gray-300">本人確認写真が登録されていません</p>
                </div>
              </div>
            )}

            {/* 訪問者情報 */}
            <div className="bg-[var(--ge-paper)] rounded-xl p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--ge-accent)] text-base truncate">
                    {visitor?.name ?? '—'}
                  </p>
                  {visitor?.company && (
                    <p className="text-sm text-gray-500 truncate">{visitor.company}</p>
                  )}
                </div>
                {item.visits?.id && (
                  <div className="flex items-center gap-2 flex-shrink-0 mt-0.5">
                    <Link
                      href={`/admin/visits/${item.visits.id}`}
                      target="_blank"
                      className="text-[10px] text-[var(--ge-accent)]/50 hover:text-[var(--ge-accent)] underline"
                    >
                      詳細 ↗
                    </Link>
                    <Link
                      href={`/admin/visits/${item.visits.id}/evidence`}
                      target="_blank"
                      className="text-[10px] px-2 py-0.5 bg-[#0f1a2e] text-white rounded-full hover:bg-[#1e3a5f] transition-colors"
                    >
                      🔒 PDF
                    </Link>
                  </div>
                )}
              </div>
              <div className="mt-2 space-y-0.5 text-xs text-gray-400">
                <p>入室: {checkIn}</p>
                {item.visits?.purpose && <p>目的: {item.visits.purpose}</p>}
                {alreadyReviewed && item.reviewed_at && (
                  <p>前回審査: {new Date(item.reviewed_at).toLocaleString('ja-JP', {
                    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}</p>
                )}
              </div>
            </div>

            {/* 申告内容 */}
            {item.declaration_text && (
              <div className="bg-gray-50 rounded-xl px-3 py-2.5">
                <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-1">申告内容</p>
                <p className="text-sm text-gray-700 leading-relaxed">{item.declaration_text}</p>
              </div>
            )}

            {/* 前回のメモ（再確認モード） */}
            {item.staff_notes && (
              <div className="bg-amber-50 rounded-xl px-3 py-2.5">
                <p className="text-[10px] text-amber-500 uppercase tracking-wide mb-1">前回のメモ</p>
                <p className="text-sm text-amber-800 leading-relaxed">📝 {item.staff_notes}</p>
              </div>
            )}

            {/* 申告日時 */}
            <p className="text-xs text-gray-300 text-center">{declTime} 申告</p>
          </div>

          {/* 下部: スタッフメモ + アクションボタン（固定） */}
          <div className="border-t border-gray-100 px-4 py-3 space-y-3 flex-shrink-0">

            {/* スタッフメモ */}
            {showNote ? (
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="スタッフメモ（任意）"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl
                           focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]/30 resize-none"
              />
            ) : (
              <button
                onClick={() => setShowNote(true)}
                className="text-xs text-gray-300 hover:text-gray-500 transition-colors"
              >
                + メモを追加（任意）
              </button>
            )}

            {/* 審査ボタン */}
            <div className="flex gap-2">
              <button
                onClick={() => handleAction('cleared')}
                disabled={saving}
                className={`flex-1 py-3 font-bold text-sm rounded-xl disabled:opacity-40 transition-colors ${
                  item.status === 'cleared'
                    ? 'bg-emerald-500 text-white ring-2 ring-emerald-300 ring-offset-1'
                    : 'bg-emerald-500 hover:bg-emerald-600 text-white'
                }`}
              >
                ✓ 問題なし <span className="text-[10px] font-normal opacity-60">[1]</span>
              </button>
              <button
                onClick={() => handleAction('flagged')}
                disabled={saving}
                className={`flex-1 py-3 font-bold text-sm rounded-xl disabled:opacity-40 transition-colors ${
                  item.status === 'flagged'
                    ? 'bg-red-500 text-white ring-2 ring-red-300 ring-offset-1'
                    : 'bg-red-500 hover:bg-red-600 text-white'
                }`}
              >
                🚩 フラグ <span className="text-[10px] font-normal opacity-60">[2]</span>
              </button>
            </div>

            {/* 前後ナビゲーション */}
            <div className="flex items-center justify-between">
              <button
                onClick={handlePrev}
                disabled={index === 0}
                className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 px-2 py-1 rounded hover:bg-gray-50 transition-colors"
              >
                ← 前へ <span className="opacity-50">[A]</span>
              </button>
              {saving && <span className="text-xs text-gray-400 animate-pulse">保存中...</span>}
              <button
                onClick={handleSkip}
                disabled={index + 1 >= items.length}
                className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30 px-2 py-1 rounded hover:bg-gray-50 transition-colors"
              >
                スキップ → <span className="opacity-50">[S]</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── メインページ ───────────────────────────────────────────────────────────────

export default function BaggageReviewPage() {
  useSiteConfig()
  const [phase, setPhase]                     = useState<'select' | 'review'>('select')
  const [selectedDate, setSelectedDate]       = useState(todayStr())
  const [includeReviewed, setIncludeReviewed] = useState(false)
  const [completedCount, setCompletedCount]   = useState(0)

  const handleStart = (date: string, withReviewed: boolean) => {
    setSelectedDate(date)
    setIncludeReviewed(withReviewed)
    setPhase('review')
  }

  const handleComplete = (count: number) => setCompletedCount(count)
  const handleBack     = ()              => setPhase('select')

  if (phase === 'review') {
    return (
      <ReviewPhase
        date={selectedDate}
        includeReviewed={includeReviewed}
        onBack={handleBack}
        onComplete={handleComplete}
      />
    )
  }

  void completedCount
  return <SelectPhase onStart={handleStart} />
}
