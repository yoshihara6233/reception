'use client'

import { useState, useEffect } from 'react'

interface Store {
  id: string
  name: string
}

// 今月のデフォルト値
function getDefaultMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

// 30日前〜今日
function getDefaultDateRange() {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - 29)
  return {
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  }
}

export default function ReportsPage() {
  const [stores, setStores] = useState<Store[]>([])

  // 月次レポート
  const [monthlyMonth, setMonthlyMonth] = useState(getDefaultMonth())
  const [monthlyStoreId, setMonthlyStoreId] = useState<string>('')
  const [monthlyLoading, setMonthlyLoading] = useState(false)
  const [monthlyError, setMonthlyError] = useState<string | null>(null)

  // 監査レポート
  const defaultRange = getDefaultDateRange()
  const [auditFrom, setAuditFrom] = useState(defaultRange.from)
  const [auditTo, setAuditTo] = useState(defaultRange.to)
  const [auditStoreId, setAuditStoreId] = useState<string>('')
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditError, setAuditError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/v1/admin/stores-list')
      .then(r => r.json())
      .then(d => setStores(d.stores ?? []))
      .catch(() => {})
  }, [])

  async function downloadMonthly() {
    setMonthlyLoading(true)
    setMonthlyError(null)
    try {
      const [year, month] = monthlyMonth.split('-').map(Number)
      const res = await fetch('/api/v1/admin/reports/monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: monthlyStoreId || null,
          year,
          month,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'エラーが発生しました' }))
        throw new Error(err.error ?? 'エラーが発生しました')
      }
      const blob = await res.blob()
      const storeName = monthlyStoreId
        ? (stores.find(s => s.id === monthlyStoreId)?.name ?? '店舗')
        : '全店舗'
      const fileName = `来訪サマリー_${storeName}_${year}年${String(month).padStart(2, '0')}月.pdf`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      setMonthlyError(e instanceof Error ? e.message : 'エラーが発生しました')
    } finally {
      setMonthlyLoading(false)
    }
  }

  async function downloadAudit() {
    setAuditLoading(true)
    setAuditError(null)
    try {
      if (auditFrom > auditTo) {
        throw new Error('開始日は終了日より前に設定してください')
      }
      const res = await fetch('/api/v1/admin/reports/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: auditStoreId || null,
          dateFrom: auditFrom,
          dateTo: auditTo,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'エラーが発生しました' }))
        throw new Error(err.error ?? 'エラーが発生しました')
      }
      const blob = await res.blob()
      const storeName = auditStoreId
        ? (stores.find(s => s.id === auditStoreId)?.name ?? '店舗')
        : '全店舗'
      const fileName = `来訪記録_${storeName}_${auditFrom}〜${auditTo}.pdf`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      a.click()
      URL.revokeObjectURL(url)
    } catch (e: unknown) {
      setAuditError(e instanceof Error ? e.message : 'エラーが発生しました')
    } finally {
      setAuditLoading(false)
    }
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">レポート</h1>
        <p className="text-sm text-gray-500 mt-1">来訪データをPDFでダウンロードできます</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* ── 月次来訪サマリー ── */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">📊</span>
            <div>
              <h2 className="font-bold text-gray-900">月次来訪サマリー</h2>
              <p className="text-xs text-gray-500 mt-0.5">本部報告・月次提出用</p>
            </div>
          </div>

          <p className="text-sm text-gray-600 leading-relaxed">
            月を選んでPDFを生成します。来訪目的別内訳・日次推移・全来訪記録を含みます。
          </p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">対象月</label>
              <input
                type="month"
                value={monthlyMonth}
                onChange={e => setMonthlyMonth(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">店舗</label>
              <select
                value={monthlyStoreId}
                onChange={e => setMonthlyStoreId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 focus:border-[#1e3a5f]"
              >
                <option value="">全店舗</option>
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {monthlyError && (
            <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{monthlyError}</p>
          )}

          <button
            onClick={downloadMonthly}
            disabled={monthlyLoading}
            className="mt-auto w-full bg-[#1e3a5f] hover:bg-[#16324f] disabled:opacity-60 text-white font-medium text-sm py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {monthlyLoading ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                生成中...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                PDFを生成
              </>
            )}
          </button>
        </div>

        {/* ── 監査用来訪履歴 ── */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🔒</span>
            <div>
              <h2 className="font-bold text-gray-900">監査用来訪履歴</h2>
              <p className="text-xs text-gray-500 mt-0.5">セキュリティ監査・第三者提出用</p>
            </div>
          </div>

          <p className="text-sm text-gray-600 leading-relaxed">
            期間を指定して全来訪記録をPDF出力します。入退室時刻・氏名・会社・部署・来訪者別集計を含みます。
          </p>

          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">開始日</label>
                <input
                  type="date"
                  value={auditFrom}
                  onChange={e => setAuditFrom(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">終了日</label>
                <input
                  type="date"
                  value={auditTo}
                  onChange={e => setAuditTo(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">店舗</label>
              <select
                value={auditStoreId}
                onChange={e => setAuditStoreId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500"
              >
                <option value="">全店舗</option>
                {stores.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {auditError && (
            <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{auditError}</p>
          )}

          <button
            onClick={downloadAudit}
            disabled={auditLoading}
            className="mt-auto w-full bg-purple-700 hover:bg-purple-800 disabled:opacity-60 text-white font-medium text-sm py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {auditLoading ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                生成中...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                PDFを生成
              </>
            )}
          </button>
        </div>
      </div>

      {/* 補足 */}
      <div className="mt-6 bg-gray-50 rounded-xl p-4 text-xs text-gray-500 space-y-1">
        <p>• 生成には数秒かかる場合があります（来訪件数が多い場合は最大30秒程度）</p>
        <p>• PDFは日本語フォントで出力され、本部提出・監査提出に適したフォーマットです</p>
        <p>• データはアクセス権限のある店舗のみ出力されます</p>
      </div>
    </div>
  )
}
