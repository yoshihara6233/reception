'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSiteConfig } from '@/lib/site-config'

// ── 型 ────────────────────────────────────────────────────────────────────────

type BaggageItem = {
  id: string
  context: 'checkin' | 'checkout'
  declaration_text: string
  status: string
  photoContentsUrl: string | null
  photoEmptyUrl: string | null
  staff_notes: string | null
  reviewed_at: string | null
  created_at: string
  visits: {
    id: string
    check_in_at: string
    stores: { name: string } | null
    visitors: { name: string; company: string } | null
  } | null
}

type PendingDate = { date: string; count: number }

// ── ヘルパー ────────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD
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

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:  { label: '審査待ち', cls: 'bg-yellow-100 text-yellow-800' },
  flagged:  { label: '🚩 フラグ', cls: 'bg-red-100 text-red-800' },
  cleared:  { label: '✓ 問題なし', cls: 'bg-emerald-100 text-emerald-800' },
  approved: { label: '✓ 承認',    cls: 'bg-blue-100 text-blue-800' },
  rejected: { label: '却下',      cls: 'bg-gray-100 text-gray-500' },
}

// ── フェーズ1: 日付選択画面 ──────────────────────────────────────────────────

function SelectPhase({
  onStart,
}: {
  onStart: (date: string, includeReviewed: boolean) => void
}) {
  const router = useRouter()
  const [selectedDate, setSelectedDate]     = useState(todayStr())
  const [pendingDates, setPendingDates]     = useState<PendingDate[]>([])
  const [loadingDates, setLoadingDates]     = useState(true)
  const [includeReviewed, setIncludeReviewed] = useState(false)
  const [totalCount, setTotalCount]         = useState<number | null>(null)
  const [loadingTotal, setLoadingTotal]     = useState(false)

  useEffect(() => {
    fetch('/api/v1/admin/baggage-pending-dates?days=30')
      .then(r => r.json())
      .then(d => setPendingDates(d.dates ?? []))
      .catch(() => {})
      .finally(() => setLoadingDates(false))
  }, [])

  // 実施済みを含む場合、選択日の全件数を取得
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

  const pendingMap    = Object.fromEntries(pendingDates.map(d => [d.date, d.count]))
  const pendingCount  = pendingMap[selectedDate] ?? 0
  const totalPending  = pendingDates.reduce((s, d) => s + d.count, 0)

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
      {/* ヘッダー */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => router.push('/admin/baggage')}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          ← 手荷物一覧
        </button>
        <h1 className="text-lg font-bold text-[var(--ge-accent)]">🔍 日次レビュー</h1>
      </div>

      {/* 未実施サマリー */}
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

      {/* 日付選択 */}
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

        {/* 選択日の件数プレビュー */}
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

        {/* 実施済みを含むトグル */}
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

// ── フェーズ2: レビュー画面 ──────────────────────────────────────────────────

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
      if (e.target instanceof HTMLTextAreaElement) return
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
    if (saving || items.length === 0) return
    const item = items[index]
    setSaving(true)
    try {
      await fetch(`/api/v1/admin/baggage/${item.id}/review`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status, staff_notes: note || undefined }),
      })
      // ローカルステータスを楽観更新
      setItems(prev => prev.map((it, i) =>
        i === index ? { ...it, status, staff_notes: note || it.staff_notes, reviewed_at: new Date().toISOString() } : it
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

  // 完了画面
  if (done) {
    return (
      <div className="max-w-xl mx-auto text-center py-20">
        <div className="text-6xl mb-4">✅</div>
        <h2 className="text-xl font-bold text-[var(--ge-accent)] mb-2">レビュー完了！</h2>
        <p className="text-gray-500 text-sm mb-2">{formatDate(date)}</p>
        <p className="text-gray-500 text-sm mb-8">{actionCount} 件のレビューを完了しました</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={onBack}
            className="px-5 py-2.5 border border-[var(--ge-accent)] text-[var(--ge-accent)] text-sm rounded-xl
                       hover:bg-[var(--ge-accent)] hover:text-white transition-colors"
          >
            別の日を選択
          </button>
          <Link
            href="/admin/baggage"
            className="px-5 py-2.5 bg-[var(--ge-accent)] text-white text-sm rounded-xl hover:bg-[var(--ge-accent)]/90 transition-colors"
          >
            一覧に戻る
          </Link>
        </div>
      </div>
    )
  }

  const item    = items[index]
  const visitor = item.visits?.visitors
  const store   = item.visits?.stores
  const checkIn = item.visits?.check_in_at
    ? new Date(item.visits.check_in_at).toLocaleString('ja-JP', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '—'
  const declTime = new Date(item.created_at).toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
  const progress = (index / items.length) * 100
  const alreadyReviewed = item.status !== 'pending'
  const badge = STATUS_BADGE[item.status]

  return (
    <div className="max-w-2xl mx-auto">

      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            ← 日付選択に戻る
          </button>
          <h1 className="text-lg font-bold text-[var(--ge-accent)]">🔍 {formatDate(date)}</h1>
          {includeReviewed && (
            <span className="px-2 py-0.5 bg-blue-50 text-blue-600 border border-blue-200 text-xs rounded-full font-medium">
              再確認モード
            </span>
          )}
        </div>
        <span className="text-sm text-gray-400">{items.length}件</span>
      </div>

      {/* プログレスバー */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-gray-500">{index + 1} / {items.length} 件目</span>
          <span className="text-xs text-gray-500">操作済み: {actionCount}件</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--ge-accent)] rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* メインカード */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">

        {/* 写真エリア — 横並び2カラム */}
        <div className="grid grid-cols-2 bg-gray-900">
          {[
            { url: item.photoContentsUrl, icon: '📦', label: '中身' },
            { url: item.photoEmptyUrl,    icon: '👜', label: '空カバン' },
          ].map(({ url, icon, label }) => (
            <div key={label} className="flex flex-col">
              <div className="flex items-center justify-center gap-1 py-1.5 bg-black/30">
                <span className="text-xs text-white/80">{icon} {label}</span>
                {!url && <span className="text-[10px] text-white/40">（なし）</span>}
              </div>
              <div className="flex items-center justify-center bg-gray-900" style={{ minHeight: 280 }}>
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={label}
                    className="w-full max-h-[320px] object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-gray-600 py-12">
                    <span className="text-4xl opacity-40">{icon}</span>
                    <p className="text-xs opacity-50">写真なし</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 情報エリア */}
        <div className="p-5">
          {/* バッジ行 */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {/* 既審査バッジ */}
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
            {store && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                {store.name}
              </span>
            )}
            <span className="text-xs text-gray-400 ml-auto">申告: {declTime}</span>
          </div>

          {/* 訪問者情報 */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="font-semibold text-[var(--ge-accent)] text-base">{visitor?.name ?? '—'}</p>
              {visitor?.company && <p className="text-sm text-gray-500">{visitor.company}</p>}
              <p className="text-xs text-gray-400 mt-0.5">入室: {checkIn}</p>
              {alreadyReviewed && item.reviewed_at && (
                <p className="text-xs text-gray-400">
                  前回審査: {new Date(item.reviewed_at).toLocaleString('ja-JP', {
                    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </p>
              )}
            </div>
            {item.visits?.id && (
              <Link
                href={`/admin/visits/${item.visits.id}`}
                className="text-xs text-[var(--ge-accent)]/60 hover:text-[var(--ge-accent)] underline flex-shrink-0"
                target="_blank"
              >
                来訪詳細 ↗
              </Link>
            )}
          </div>

          {/* 申告テキスト */}
          {item.declaration_text && (
            <div className="bg-gray-50 rounded-xl px-4 py-3 mb-4">
              <p className="text-xs text-gray-400 mb-1">申告内容</p>
              <p className="text-sm text-gray-700 leading-relaxed">{item.declaration_text}</p>
            </div>
          )}

          {/* 既存のスタッフメモ（再確認モードで前回のメモを表示） */}
          {item.staff_notes && (
            <div className="bg-amber-50 rounded-xl px-4 py-3 mb-4">
              <p className="text-xs text-amber-600 mb-1">前回のメモ</p>
              <p className="text-sm text-amber-800 leading-relaxed">📝 {item.staff_notes}</p>
            </div>
          )}

          {/* スタッフメモ（任意） */}
          {showNote ? (
            <div className="mb-4">
              <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="スタッフメモ（任意）"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]/30 resize-none"
              />
            </div>
          ) : (
            <button
              onClick={() => setShowNote(true)}
              className="text-xs text-gray-400 hover:text-gray-600 mb-4 block"
            >
              + メモを追加（任意）
            </button>
          )}

          {/* アクションボタン */}
          <div className="flex gap-3 mb-3">
            <button
              onClick={() => handleAction('cleared')}
              disabled={saving}
              className={`flex-1 py-3.5 font-bold text-base rounded-xl disabled:opacity-40 transition-colors flex items-center justify-center gap-2 ${
                item.status === 'cleared'
                  ? 'bg-emerald-500 text-white ring-2 ring-emerald-300'
                  : 'bg-emerald-500 hover:bg-emerald-600 text-white'
              }`}
            >
              ✓ 問題なし
              <span className="text-xs font-normal opacity-70">[1]</span>
            </button>
            <button
              onClick={() => handleAction('flagged')}
              disabled={saving}
              className={`flex-1 py-3.5 font-bold text-base rounded-xl disabled:opacity-40 transition-colors flex items-center justify-center gap-2 ${
                item.status === 'flagged'
                  ? 'bg-red-500 text-white ring-2 ring-red-300'
                  : 'bg-red-500 hover:bg-red-600 text-white'
              }`}
            >
              🚩 フラグ
              <span className="text-xs font-normal opacity-70">[2]</span>
            </button>
          </div>

          {/* 録画再生リンク */}
          <Link
            href={`/admin/baggage/${item.id}/recording`}
            target="_blank"
            className="w-full mb-4 py-2.5 bg-[var(--ge-accent)]/10 text-[var(--ge-accent)] rounded-xl text-sm font-medium
                       hover:bg-[var(--ge-accent)]/15 transition-colors flex items-center justify-center gap-2"
            title="両カメラの録画を同時再生（モック）"
          >
            📹 カメラ録画を再生（2カメラ同期）
          </Link>

          {/* ナビゲーション */}
          <div className="flex items-center justify-between">
            <button
              onClick={handlePrev}
              disabled={index === 0}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-xl
                         hover:bg-gray-50 disabled:opacity-30 transition-colors"
            >
              ← 前へ <span className="text-xs opacity-60">[A]</span>
            </button>
            {saving && <span className="text-xs text-gray-400">保存中...</span>}
            <button
              onClick={handleSkip}
              disabled={index + 1 >= items.length}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-500 border border-gray-200 rounded-xl
                         hover:bg-gray-50 disabled:opacity-30 transition-colors"
            >
              スキップ → <span className="text-xs opacity-60">[S]</span>
            </button>
          </div>
        </div>
      </div>

      {/* キーボードショートカット */}
      <p className="text-center text-xs text-gray-300 mt-4">
        キーボード: [1] 問題なし　[2] フラグ　[A] 前へ　[S] スキップ
      </p>
    </div>
  )
}

// ── メインページ（フェーズ管理） ──────────────────────────────────────────────

export default function BaggageReviewPage() {
  useSiteConfig()
  const [phase, setPhase]               = useState<'select' | 'review'>('select')
  const [selectedDate, setSelectedDate] = useState(todayStr())
  const [includeReviewed, setIncludeReviewed] = useState(false)
  const [completedCount, setCompletedCount] = useState(0)

  const handleStart = (date: string, withReviewed: boolean) => {
    setSelectedDate(date)
    setIncludeReviewed(withReviewed)
    setPhase('review')
  }

  const handleComplete = (count: number) => {
    setCompletedCount(count)
  }

  const handleBack = () => {
    setPhase('select')
  }

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
