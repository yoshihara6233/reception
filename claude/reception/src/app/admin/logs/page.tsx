'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// ── 型 ────────────────────────────────────────────────────────────────────────

type LogEntry = {
  id: string
  action: string
  resource_type: string
  resource_id: string | null
  details: Record<string, unknown>
  ip_address: string | null
  user_agent: string | null
  created_at: string
  admin_users: { id: string; name: string; email: string; role: string } | null
}

type AdminUser = { id: string; name: string; email: string }

// ── ラベル・スタイル定義 ──────────────────────────────────────────────────────

const ACTION_META: Record<string, { label: string; color: string }> = {
  login:           { label: 'ログイン',     color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  logout:          { label: 'ログアウト',   color: 'bg-gray-100 text-gray-600 border-gray-200' },
  login_failed:    { label: 'ログイン失敗', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  visit_checkin:   { label: 'チェックイン', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  visit_checkout:  { label: 'チェックアウト', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  visit_view:      { label: '来訪参照',     color: 'bg-gray-50 text-gray-600 border-gray-200' },
  visit_export:    { label: '来訪エクスポート', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  baggage_review:  { label: '手荷物審査',   color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  baggage_export:  { label: '手荷物エクスポート', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  settings_update: { label: '設定変更',     color: 'bg-amber-50 text-amber-700 border-amber-200' },
  user_create:     { label: 'ユーザー作成', color: 'bg-teal-50 text-teal-700 border-teal-200' },
  user_update:     { label: 'ユーザー変更', color: 'bg-teal-50 text-teal-700 border-teal-200' },
  user_delete:     { label: 'ユーザー削除', color: 'bg-red-50 text-red-700 border-red-200' },
  store_create:    { label: '拠点作成',     color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  store_update:    { label: '拠点変更',     color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
  store_delete:    { label: '拠点削除',     color: 'bg-red-50 text-red-700 border-red-200' },
  qr_rotate:       { label: 'QR更新',       color: 'bg-pink-50 text-pink-700 border-pink-200' },
  prereg_create:   { label: '来客登録作成', color: 'bg-sky-50 text-sky-700 border-sky-200' },
  prereg_delete:   { label: '来客登録削除', color: 'bg-red-50 text-red-700 border-red-200' },
}

const RESOURCE_LABEL: Record<string, string> = {
  visit:    '来訪',
  visitor:  '訪問者',
  baggage:  '手荷物',
  settings: '設定',
  user:     'ユーザー',
  store:    '拠点',
  area:     'エリア',
}

const LOG_TYPE_TABS = [
  { value: 'all',       label: '全ログ' },
  { value: 'access',    label: 'アクセス' },
  { value: 'operation', label: '操作' },
  { value: 'settings',  label: '設定変更' },
]

// ── サブコンポーネント ────────────────────────────────────────────────────────

function ActionBadge({ action }: { action: string }) {
  const m = ACTION_META[action] ?? { label: action, color: 'bg-gray-100 text-gray-500 border-gray-200' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${m.color}`}>
      {m.label}
    </span>
  )
}

function DetailsCell({ details }: { details: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  const keys = Object.keys(details ?? {})
  if (keys.length === 0) return <span className="text-gray-300 text-xs">—</span>

  const preview = keys.slice(0, 2).map(k => `${k}: ${String(details[k])}`).join(', ')
  return (
    <div className="text-xs">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-[var(--ge-accent)]/60 hover:text-[var(--ge-accent)] underline"
      >
        {open ? '▲ 閉じる' : `▼ ${preview.slice(0, 40)}${preview.length > 40 ? '…' : ''}`}
      </button>
      {open && (
        <pre className="mt-1 bg-gray-50 rounded p-2 text-[11px] leading-relaxed max-w-xs overflow-x-auto whitespace-pre-wrap">
          {JSON.stringify(details, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ── メインページ ──────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [logs, setLogs]           = useState<LogEntry[]>([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [apiError, setApiError]   = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [page, setPage]           = useState(1)
  const perPage = 50

  // フィルター
  const [logType,      setLogType]      = useState('all')
  const [userId,       setUserId]       = useState('')
  const [action,       setAction]       = useState('')
  const [resourceType, setResourceType] = useState('')
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [search,       setSearch]       = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortDir,      setSortDir]      = useState<'desc' | 'asc'>('desc')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 350)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [search])

  // データ取得
  const fetchLogs = useCallback(async (pg = 1) => {
    setLoading(true)
    setApiError(null)
    try {
      const params = new URLSearchParams({ page: String(pg), sortDir })
      if (logType      && logType !== 'all') params.set('logType',      logType)
      if (userId)       params.set('userId',       userId)
      if (action)       params.set('action',       action)
      if (resourceType) params.set('resourceType', resourceType)
      if (dateFrom)     params.set('dateFrom',     dateFrom)
      if (dateTo)       params.set('dateTo',       dateTo)
      if (debouncedSearch) params.set('search',    debouncedSearch)

      const res  = await fetch(`/api/v1/admin/logs?${params}`)
      const data = await res.json()
      if (!res.ok) {
        setApiError(data.error ?? `エラー (${res.status})`)
        setLogs([])
        setTotal(0)
        return
      }
      setLogs(data.logs ?? [])
      setTotal(data.total ?? 0)
      setPage(pg)
      if (data.adminUsers?.length) setAdminUsers(data.adminUsers)
    } catch (e) {
      setApiError(e instanceof Error ? e.message : '通信エラー')
      setLogs([])
    } finally {
      setLoading(false)
    }
  }, [logType, userId, action, resourceType, dateFrom, dateTo, debouncedSearch, sortDir])

  useEffect(() => { fetchLogs(1) }, [fetchLogs])

  const handleExport = async () => {
    setExporting(true)
    const params = new URLSearchParams({ sortDir })
    if (logType      && logType !== 'all') params.set('logType',      logType)
    if (userId)       params.set('userId',       userId)
    if (action)       params.set('action',       action)
    if (resourceType) params.set('resourceType', resourceType)
    if (dateFrom)     params.set('dateFrom',     dateFrom)
    if (dateTo)       params.set('dateTo',       dateTo)
    if (debouncedSearch) params.set('search',    debouncedSearch)

    const res  = await fetch(`/api/v1/admin/logs-export?${params}`)
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  const clearFilters = () => {
    setUserId(''); setAction(''); setResourceType('')
    setDateFrom(''); setDateTo(''); setSearch('')
    setDebouncedSearch('')
  }

  const activeFilterCount = [userId, action, resourceType, dateFrom, dateTo, debouncedSearch].filter(Boolean).length
  const totalPages = Math.ceil(total / perPage)

  // ── アクション選択肢（logType に連動） ────────────────────────────────────
  const ALL_ACTIONS = Object.keys(ACTION_META)
  const ACCESS_ACTIONS    = ['login', 'logout', 'login_failed']
  const OPERATION_ACTIONS = ['visit_checkin', 'visit_checkout', 'visit_view', 'visit_export', 'baggage_review', 'baggage_export', 'prereg_create', 'prereg_delete']
  const SETTINGS_ACTIONS  = ['settings_update', 'user_create', 'user_update', 'user_delete', 'store_create', 'store_update', 'store_delete', 'qr_rotate']
  const availableActions  = logType === 'access' ? ACCESS_ACTIONS
    : logType === 'operation' ? OPERATION_ACTIONS
    : logType === 'settings'  ? SETTINGS_ACTIONS
    : ALL_ACTIONS

  return (
    <div>
      {/* ── ヘッダー ── */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-[#1e3a5f]">操作ログ</h1>
          <span className="text-sm text-gray-400">{total.toLocaleString()}件</span>
          {activeFilterCount > 0 && (
            <span className="px-2 py-0.5 bg-[var(--ge-accent)] text-white text-xs rounded-full font-medium">
              {activeFilterCount}件のフィルター
            </span>
          )}
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 py-2 border border-[var(--ge-accent)] text-[var(--ge-accent)] text-sm rounded-lg
                     hover:bg-[var(--ge-accent)] hover:text-white transition-colors disabled:opacity-40"
        >
          {exporting ? 'エクスポート中...' : 'CSV出力'}
        </button>
      </div>

      {/* ── ログ種別タブ ── */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {LOG_TYPE_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => { setLogType(tab.value); setAction(''); setPage(1) }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
              logType === tab.value
                ? 'bg-[var(--ge-accent)] text-white border-[var(--ge-accent)]'
                : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── フィルターバー ── */}
      <div className="bg-white rounded-2xl shadow-sm px-4 py-3 mb-5 space-y-2.5">
        {/* 行1: 日付 + ソート + クリア */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3 py-1.5">
            <span className="text-xs text-gray-500 whitespace-nowrap">📅 期間</span>
            <input type="date" value={dateFrom} max={dateTo || undefined}
              onChange={e => { setDateFrom(e.target.value); setPage(1) }}
              className="text-sm border-none outline-none bg-transparent cursor-pointer text-gray-700" />
            <span className="text-gray-400 text-sm">〜</span>
            <input type="date" value={dateTo} min={dateFrom || undefined}
              onChange={e => { setDateTo(e.target.value); setPage(1) }}
              className="text-sm border-none outline-none bg-transparent cursor-pointer text-gray-700" />
          </div>

          <button
            onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
            className="flex items-center gap-1.5 h-8 px-3 border border-gray-200 rounded-lg text-sm text-gray-600 hover:border-gray-300 whitespace-nowrap"
          >
            {sortDir === 'desc' ? '↓ 新着順' : '↑ 古い順'}
          </button>

          {activeFilterCount > 0 && (
            <button onClick={clearFilters}
              className="flex items-center gap-1 h-8 px-3 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
              ✕ クリア
            </button>
          )}
        </div>

        {/* 行2: ドロップダウン + テキスト検索 */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* ユーザー */}
          <select value={userId} onChange={e => { setUserId(e.target.value); setPage(1) }}
            className="h-8 text-sm px-2 border border-gray-200 rounded-lg bg-white focus:outline-none">
            <option value="">👤 全ユーザー</option>
            {adminUsers.map(u => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>

          {/* アクション */}
          <select value={action} onChange={e => { setAction(e.target.value); setPage(1) }}
            className="h-8 text-sm px-2 border border-gray-200 rounded-lg bg-white focus:outline-none">
            <option value="">全アクション</option>
            {availableActions.map(a => (
              <option key={a} value={a}>{ACTION_META[a]?.label ?? a}</option>
            ))}
          </select>

          {/* リソース種別 */}
          <select value={resourceType} onChange={e => { setResourceType(e.target.value); setPage(1) }}
            className="h-8 text-sm px-2 border border-gray-200 rounded-lg bg-white focus:outline-none">
            <option value="">全リソース</option>
            {Object.entries(RESOURCE_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>

          {/* キーワード */}
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="🔍 キーワード検索"
            className="h-8 text-sm px-3 border border-gray-200 rounded-lg bg-white w-48
                       focus:outline-none focus:ring-2 focus:ring-[var(--ge-accent)]/20 placeholder-gray-300"
          />
        </div>
      </div>

      {/* ── テーブル ── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center h-40 gap-2 text-gray-400">
          <div className="w-6 h-6 border-2 border-gray-200 border-t-[var(--ge-accent)] rounded-full animate-spin" />
          読み込み中...
        </div>
      ) : apiError ? (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
          <p className="text-2xl mb-2">⚠️</p>
          <p className="font-medium text-sm text-red-700">ログの取得に失敗しました</p>
          <p className="text-xs text-red-500 mt-1 font-mono">{apiError}</p>
          <button onClick={() => fetchLogs(page)} className="mt-3 text-xs text-red-600 underline">再試行</button>
        </div>
      ) : logs.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-12 text-center text-gray-400">
          <p className="text-3xl mb-3">📭</p>
          <p className="font-medium text-sm">ログが見つかりません</p>
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className="mt-2 text-xs text-[var(--ge-accent)] underline">
              フィルターをクリア
            </button>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 w-36">日時</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 w-28">ユーザー</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 w-32">アクション</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 w-24">リソース</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 w-28">IPアドレス</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">詳細</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {logs.map(log => {
                const dt = new Date(log.created_at)
                const dateStr = dt.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
                const timeStr = dt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

                return (
                  <tr key={log.id} className="hover:bg-gray-50/50 transition-colors">
                    {/* 日時 */}
                    <td className="px-4 py-3">
                      <p className="text-xs font-medium text-gray-700">{dateStr}</p>
                      <p className="text-xs text-gray-400 font-mono">{timeStr}</p>
                    </td>

                    {/* ユーザー */}
                    <td className="px-4 py-3">
                      {log.admin_users ? (
                        <div>
                          <p className="text-xs font-medium text-gray-700 truncate max-w-[100px]">
                            {log.admin_users.name}
                          </p>
                          <p className="text-[10px] text-gray-400 truncate max-w-[100px]">
                            {log.admin_users.email}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>

                    {/* アクション */}
                    <td className="px-4 py-3">
                      <ActionBadge action={log.action} />
                    </td>

                    {/* リソース */}
                    <td className="px-4 py-3">
                      <p className="text-xs text-gray-600">
                        {RESOURCE_LABEL[log.resource_type] ?? log.resource_type}
                      </p>
                      {log.resource_id && (
                        <p className="text-[10px] text-gray-300 font-mono truncate max-w-[80px]">
                          {log.resource_id.slice(0, 8)}…
                        </p>
                      )}
                    </td>

                    {/* IP */}
                    <td className="px-4 py-3">
                      <p className="text-xs text-gray-500 font-mono">{log.ip_address ?? '—'}</p>
                      {log.user_agent && (
                        <p className="text-[10px] text-gray-300 truncate max-w-[100px]" title={log.user_agent}>
                          {log.user_agent.slice(0, 20)}…
                        </p>
                      )}
                    </td>

                    {/* 詳細 */}
                    <td className="px-4 py-3">
                      <DetailsCell details={log.details} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── ページネーション ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-6">
          <button onClick={() => fetchLogs(Math.max(1, page - 1))} disabled={page === 1}
            className="px-2 py-1 rounded text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-30">‹</button>
          {(() => {
            const pages: (number | '...')[] = []
            for (let p = 1; p <= totalPages; p++) {
              if (p === 1 || p === totalPages || (p >= page - 2 && p <= page + 2)) pages.push(p)
              else if (pages[pages.length - 1] !== '...') pages.push('...')
            }
            return pages.map((p, i) =>
              p === '...' ? (
                <span key={`dot-${i}`} className="px-1 text-gray-400 text-sm">…</span>
              ) : (
                <button key={p} onClick={() => fetchLogs(p as number)}
                  className={`px-2.5 py-1 rounded text-sm ${p === page ? 'bg-[var(--ge-accent)] text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
                  {p}
                </button>
              )
            )
          })()}
          <button onClick={() => fetchLogs(Math.min(totalPages, page + 1))} disabled={page === totalPages}
            className="px-2 py-1 rounded text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-30">›</button>
          <span className="ml-2 text-xs text-gray-400">{page}/{totalPages}</span>
        </div>
      )}
    </div>
  )
}
