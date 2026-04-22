'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useSiteConfig } from '@/lib/site-config'

// ── 型 ────────────────────────────────────────────────────────────────────────

type BaggageDeclaration = {
  id: string
  context: 'checkin' | 'checkout'
  declaration_text: string
  status: string
  photo_path_contents: string | null
  photo_path_empty: string | null
  photoContentsUrl: string | null
  photoEmptyUrl: string | null
  staff_notes: string | null
  reviewed_at: string | null
  created_at: string
  visits: {
    id: string
    check_in_at: string
    stores: { id: string; name: string } | null
    visitors: { name: string; company: string } | null
  } | null
}

type Store = { id: string; name: string }

// ── 定数 ──────────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { value: '',        label: '未審査',   color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  { value: 'cleared', label: '問題なし', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'flagged', label: 'フラグ',   color: 'bg-red-50 text-red-700 border-red-200' },
  { value: 'all',     label: '全件',     color: 'bg-gray-100 text-gray-600 border-gray-200' },
]

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pending:  { label: '審査待ち', cls: 'bg-yellow-50 text-yellow-700 border border-yellow-200' },
  flagged:  { label: 'フラグ',   cls: 'bg-red-50 text-red-700 border border-red-200' },
  cleared:  { label: '問題なし', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  approved: { label: '承認',     cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
  rejected: { label: '却下',     cls: 'bg-gray-100 text-gray-600 border border-gray-200' },
}

// ── サブコンポーネント ────────────────────────────────────────────���────────────

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_BADGE[status] ?? { label: status, cls: 'bg-gray-100 text-gray-500 border border-gray-200' }
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.cls}`}>{s.label}</span>
}

function FilterInput({
  value, onChange, placeholder, className = '',
}: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`h-8 text-sm px-3 border border-gray-200 rounded-lg bg-white placeholder-gray-300
                  focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]/30 focus:border-[var(--ge-accent)]/40 ${className}`}
    />
  )
}

function FilterSelect({
  value, onChange, className = '', children,
}: { value: string; onChange: (v: string) => void; className?: string; children: React.ReactNode }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`h-8 text-sm px-2 border border-gray-200 rounded-lg bg-white
                  focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]/30 focus:border-[var(--ge-accent)]/40 ${className}`}
    >
      {children}
    </select>
  )
}

// ── メインページ ──────────────────────────────────────────────────────────────

export default function BaggagePage() {
  const { locationName } = useSiteConfig()
  const router = useRouter()
  const [declarations, setDeclarations] = useState<BaggageDeclaration[]>([])
  const [total, setTotal]               = useState(0)
  const [loading, setLoading]           = useState(true)
  const [stores, setStores]             = useState<Store[]>([])
  const [savingId, setSavingId]         = useState<string | null>(null)
  const [exporting, setExporting]       = useState(false)
  const [page, setPage]                 = useState(1)
  const perPage = 20

  // ── フィルタ ──────────────────────────────
  const [statusFilter,  setStatusFilter]  = useState('')            // '' = 要対応(pending+flagged)
  const [filterStore,   setFilterStore]   = useState('')
  const [filterContext, setFilterContext] = useState('')
  const [filterName,    setFilterName]    = useState('')
  const [filterCompany, setFilterCompany] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo,   setFilterDateTo]   = useState('')
  const [sortDir,       setSortDir]       = useState<'desc' | 'asc'>('desc')

  // デバウンス用
  const [debouncedName,    setDebouncedName]    = useState('')
  const [debouncedCompany, setDebouncedCompany] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedName(filterName)
      setDebouncedCompany(filterCompany)
    }, 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [filterName, filterCompany])

  // ── アクティブフィルタ数 ───────────────────
  const activeFilterCount = [
    filterStore, filterContext, debouncedName, debouncedCompany, filterDateFrom, filterDateTo,
  ].filter(Boolean).length

  const clearAllFilters = () => {
    setFilterStore(''); setFilterContext('')
    setFilterName('');  setDebouncedName('')
    setFilterCompany(''); setDebouncedCompany('')
    setFilterDateFrom(''); setFilterDateTo('')
    setPage(1)
  }

  // ── データ取得 ────────────────────────────
  const fetchDeclarations = useCallback(async (pg = 1) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(pg), sortDir })
      if (statusFilter) params.set('status', statusFilter)  // 'all' もそのまま渡す（API側で処理）
      if (filterStore)        params.set('storeId',     filterStore)
      if (filterContext)      params.set('context',     filterContext)
      if (debouncedName)      params.set('visitorName', debouncedName)
      if (debouncedCompany)   params.set('company',     debouncedCompany)
      if (filterDateFrom)     params.set('dateFrom',    filterDateFrom)
      if (filterDateTo)       params.set('dateTo',      filterDateTo)

      const res  = await fetch(`/api/v1/admin/baggage-list?${params}`)
      const data = await res.json()
      setDeclarations(data.declarations ?? [])
      setTotal(data.total ?? 0)
      setPage(pg)
      if (data.stores?.length) setStores(data.stores)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, filterStore, filterContext, debouncedName, debouncedCompany,
      filterDateFrom, filterDateTo, sortDir])

  useEffect(() => { fetchDeclarations(1) }, [fetchDeclarations])

  // ── 審査アクション ────────────────────────
  async function handleReview(id: string, newStatus: string) {
    setSavingId(id)
    try {
      await fetch(`/api/v1/admin/baggage/${id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      await fetchDeclarations(page)
    } finally {
      setSavingId(null)
    }
  }

  // ── CSV エクスポート ──────────────────────
  const handleExport = async () => {
    setExporting(true)
    const params = new URLSearchParams({ sortDir })
    if (statusFilter) params.set('status', statusFilter)
    if (filterStore)      params.set('storeId',     filterStore)
    if (filterContext)    params.set('context',     filterContext)
    if (debouncedName)    params.set('visitorName', debouncedName)
    if (debouncedCompany) params.set('company',     debouncedCompany)
    if (filterDateFrom)   params.set('dateFrom',    filterDateFrom)
    if (filterDateTo)     params.set('dateTo',      filterDateTo)

    const res  = await fetch(`/api/v1/admin/baggage-export?${params}`)
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `baggage_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  const totalPages = Math.ceil(total / perPage)

  // ── レンダリング ──────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── ヘッダー ── */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-[var(--ge-accent)]">🧳 手荷物検査</h1>
          <span className="text-sm text-gray-400">{total}件</span>
          {activeFilterCount > 0 && (
            <span className="px-2 py-0.5 bg-[var(--ge-accent)] text-white text-xs rounded-full font-medium">
              {activeFilterCount}件のフィルター
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => router.push('/admin/baggage/review')}
            className="px-4 py-2 bg-[var(--ge-accent)] text-white text-sm rounded-lg
                       hover:bg-[var(--ge-accent)]/90 transition-colors flex items-center gap-1.5"
          >
            🔍 日次レビュー
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 border border-[var(--ge-accent)] text-[var(--ge-accent)] text-sm rounded-lg
                       hover:bg-[var(--ge-accent)] hover:text-white transition-colors disabled:opacity-40"
          >
            {exporting ? 'エクスポート中...' : 'CSV出力'}
          </button>
        </div>
      </div>

      {/* ── ステータスタブ ── */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => { setStatusFilter(tab.value); setPage(1) }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              statusFilter === tab.value
                ? tab.color + ' ring-2 ring-offset-1 ring-[var(--ge-accent)]/30'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── フィルターバー ── */}
      <div className="bg-white rounded-2xl shadow-sm px-4 py-3 mb-5 space-y-3">
        {/* 行1: 日付範囲 + ソート */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-1.5">
            <span className="text-xs text-gray-500 font-medium whitespace-nowrap">📅 申告日</span>
            <input
              type="date"
              value={filterDateFrom}
              onChange={e => { setFilterDateFrom(e.target.value); setPage(1) }}
              className="text-sm text-gray-700 border-none outline-none bg-transparent cursor-pointer"
            />
            <span className="text-gray-400 text-sm">〜</span>
            <input
              type="date"
              value={filterDateTo}
              onChange={e => { setFilterDateTo(e.target.value); setPage(1) }}
              min={filterDateFrom || undefined}
              className="text-sm text-gray-700 border-none outline-none bg-transparent cursor-pointer"
            />
          </div>

          <button
            onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            className="flex items-center gap-1.5 h-8 px-3 border border-gray-200 rounded-lg text-sm text-gray-600 hover:border-gray-300 transition-colors whitespace-nowrap"
          >
            {sortDir === 'desc' ? '↓ 新着順' : '↑ 古い順'}
          </button>

          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="flex items-center gap-1 h-8 px-3 text-sm text-gray-500 border border-gray-200
                         rounded-lg hover:bg-gray-50 hover:text-gray-700 transition-colors"
            >
              ✕ フィルターをクリア
            </button>
          )}
        </div>

        {/* 行2: テキスト・ドロップダウンフィルタ */}
        <div className="flex items-center gap-2 flex-wrap">
          <FilterInput
            value={filterName}
            onChange={v => { setFilterName(v); setPage(1) }}
            placeholder="👤 訪問者名で絞込"
            className="w-44"
          />
          <FilterInput
            value={filterCompany}
            onChange={v => { setFilterCompany(v); setPage(1) }}
            placeholder="🏢 会社名で絞込"
            className="w-44"
          />
          <FilterSelect
            value={filterStore}
            onChange={v => { setFilterStore(v); setPage(1) }}
            className="w-36"
          >
            <option value="">全{locationName}</option>
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </FilterSelect>
          <FilterSelect
            value={filterContext}
            onChange={v => { setFilterContext(v); setPage(1) }}
            className="w-28"
          >
            <option value="">入退室：全て</option>
            <option value="checkin">入室時のみ</option>
            <option value="checkout">退室時のみ</option>
          </FilterSelect>
        </div>
      </div>

      {/* ── カードリスト ── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-400">
          <div className="w-6 h-6 border-2 border-gray-200 border-t-[var(--ge-accent)] rounded-full animate-spin" />
          読み込み中...
        </div>
      ) : declarations.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-12 text-center text-gray-400">
          <p className="text-4xl mb-3">✅</p>
          <p className="font-medium">該当する手荷物申告はありません</p>
          {activeFilterCount > 0 && (
            <button onClick={clearAllFilters} className="mt-3 text-xs text-[var(--ge-accent)] underline">
              フィルターをクリアして全件表示
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {declarations.map(decl => {
            const visitor = decl.visits?.visitors
            const store   = decl.visits?.stores
            const checkIn = decl.visits?.check_in_at
              ? new Date(decl.visits.check_in_at).toLocaleString('ja-JP', {
                  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })
              : '—'
            const declDate = new Date(decl.created_at).toLocaleString('ja-JP', {
              month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })

            return (
              <div key={decl.id} className="bg-white rounded-2xl shadow-sm p-5">
                <div className="flex items-start gap-4">
                  {/* 写真サムネイル */}
                  <div className="flex gap-2 flex-shrink-0">
                    {[
                      { url: decl.photoContentsUrl, icon: '📦', label: '中身' },
                      { url: decl.photoEmptyUrl,    icon: '👜', label: '空カバン' },
                    ].map(({ url, icon, label }) => (
                      <div key={label}
                        className="w-20 h-20 rounded-xl overflow-hidden bg-gray-100 border border-gray-100 flex-shrink-0">
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt={label} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 gap-0.5">
                            <span className="text-xl">{icon}</span>
                            <span className="text-[9px]">{label}なし</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* 情報 */}
                  <div className="flex-1 min-w-0">
                    {/* メタ情報バッジ行 */}
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <StatusBadge status={decl.status} />
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                        decl.context === 'checkin'
                          ? 'bg-purple-50 text-purple-700 border-purple-200'
                          : 'bg-orange-50 text-orange-700 border-orange-200'
                      }`}>
                        {decl.context === 'checkin' ? '入室時' : '退室時'}
                      </span>
                      {store && (
                        <span className="text-xs text-gray-400">{store.name}</span>
                      )}
                      <span className="text-xs text-gray-400">申告: {declDate}</span>
                      {decl.reviewed_at && (
                        <span className="text-xs text-gray-400">
                          審査: {new Date(decl.reviewed_at).toLocaleString('ja-JP', {
                            month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      )}
                    </div>

                    {/* 訪問者 + リンク */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-semibold text-[var(--ge-accent)]">
                        {visitor?.name ?? '—'}
                      </span>
                      {visitor?.company && (
                        <span className="text-xs text-gray-500">{visitor.company}</span>
                      )}
                      <span className="text-xs text-gray-400 ml-1">入室: {checkIn}</span>
                      {decl.visits?.id && (
                        <Link
                          href={`/admin/visits/${decl.visits.id}`}
                          className="text-xs text-[var(--ge-accent)]/60 hover:text-[var(--ge-accent)] underline ml-auto flex-shrink-0"
                        >
                          来訪詳細 →
                        </Link>
                      )}
                    </div>

                    {/* 申告テキスト */}
                    {decl.declaration_text && (
                      <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 mb-3 leading-relaxed line-clamp-2">
                        {decl.declaration_text}
                      </p>
                    )}

                    {/* スタッフメモ */}
                    {decl.staff_notes && (
                      <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5 mb-3">
                        📝 {decl.staff_notes}
                      </p>
                    )}

                    {/* 審査ボタン（実施済みでも再審査可能） */}
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => handleReview(decl.id, 'cleared')}
                        disabled={savingId === decl.id}
                        className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                          decl.status === 'cleared'
                            ? 'bg-emerald-500 text-white ring-2 ring-emerald-300'
                            : 'bg-gray-100 text-gray-500 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40'
                        }`}
                      >
                        ✓ 問題なし
                      </button>
                      <button
                        onClick={() => handleReview(decl.id, 'flagged')}
                        disabled={savingId === decl.id}
                        className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                          decl.status === 'flagged'
                            ? 'bg-red-500 text-white ring-2 ring-red-300'
                            : 'bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-40'
                        }`}
                      >
                        🚩 フラグ
                      </button>
                      <Link
                        href={`/admin/baggage/${decl.id}/recording`}
                        className="px-3 py-1 text-xs rounded-lg bg-[var(--ge-accent)]/10 text-[var(--ge-accent)] font-medium
                                   hover:bg-[var(--ge-accent)]/15 transition-colors flex items-center gap-1"
                        title="i-PRO Remo 録画を再生（モック）"
                      >
                        📹 録画
                      </Link>
                      {savingId === decl.id && (
                        <span className="text-xs text-gray-400 self-center">保存中...</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── ページネーション ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-6">
          <button
            onClick={() => fetchDeclarations(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-2 py-1 rounded text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-30"
          >
            ‹
          </button>
          {(() => {
            const pages: (number | '...')[] = []
            for (let p = 1; p <= totalPages; p++) {
              if (p === 1 || p === totalPages || (p >= page - 2 && p <= page + 2)) {
                pages.push(p)
              } else if (pages[pages.length - 1] !== '...') {
                pages.push('...')
              }
            }
            return pages.map((p, i) =>
              p === '...' ? (
                <span key={`dot-${i}`} className="px-1 text-gray-400 text-sm">…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => fetchDeclarations(p as number)}
                  className={`px-2.5 py-1 rounded text-sm ${
                    p === page ? 'bg-[var(--ge-accent)] text-white' : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {p}
                </button>
              )
            )
          })()}
          <button
            onClick={() => fetchDeclarations(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="px-2 py-1 rounded text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-30"
          >
            ›
          </button>
          <span className="ml-2 text-xs text-gray-400">{page}/{totalPages}</span>
        </div>
      )}
    </div>
  )
}
