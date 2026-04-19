'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useLocale } from '@/lib/i18n/useLocale'

interface Visit {
  id: string
  purpose: string
  status: string
  check_in_at: string
  check_out_at: string | null
  visitors: { company: string; name: string; department?: string } | null
  stores: { name: string } | null
}

function StatusBadge({ status, t }: { status: string; t: (k: string) => string }) {
  const styles: Record<string, string> = {
    checked_in: 'bg-emerald-50 text-emerald-700',
    checked_out: 'bg-gray-100 text-gray-600',
    auto_closed: 'bg-yellow-50 text-yellow-700',
  }
  const labelKeys: Record<string, string> = {
    checked_in: 'admin.statusCheckedIn',
    checked_out: 'admin.statusCheckedOut',
    auto_closed: 'admin.statusAutoClosed',
  }
  return (
    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${styles[status] || ''}`}>
      {labelKeys[status] ? t(labelKeys[status]) : status}
    </span>
  )
}

export default function VisitsPage() {
  const { t, locale } = useLocale()
  const [visits, setVisits] = useState<Visit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [date, setDate] = useState('')
  const [exporting, setExporting] = useState(false)
  const perPage = 20

  const fetchVisits = useCallback(async (pg = 1) => {
    setLoading(true)
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (status) params.set('status', status)
    if (date) params.set('date', date)
    params.set('page', String(pg))
    const res = await fetch(`/api/v1/admin/visits-list?${params}`)
    const data = await res.json()
    setVisits(data.visits || [])
    setTotal(data.total || 0)
    setPage(pg)
    setLoading(false)
  }, [q, status, date])

  useEffect(() => {
    fetchVisits(1)
  }, [fetchVisits])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchVisits(1)
  }

  const handleExport = async () => {
    setExporting(true)
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (status) params.set('status', status)
    if (date) params.set('date', date)
    const res = await fetch(`/api/v1/admin/visits-export?${params}`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `visits_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    setExporting(false)
  }

  const totalPages = Math.ceil(total / perPage)

  const dateLocale = locale === 'zh' ? 'zh-CN' : locale === 'ko' ? 'ko-KR' : locale === 'en' ? 'en-US' : 'ja-JP'

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[#1e3a5f]">{t('admin.visits')}</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">{total}{t('admin.total')}</span>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="px-4 py-2 border border-[#1e3a5f] text-[#1e3a5f] text-sm rounded-lg hover:bg-[#1e3a5f] hover:text-white transition-colors disabled:opacity-40"
          >
            {exporting ? t('admin.exporting') : t('admin.exportCsv')}
          </button>
        </div>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="flex gap-3 mb-6">
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={t('admin.searchPlaceholder')}
          className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 placeholder-gray-400 w-64 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
        />
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
        />
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
        >
          <option value="">{t('admin.allStatuses')}</option>
          <option value="checked_in">{t('admin.statusCheckedIn')}</option>
          <option value="checked_out">{t('admin.statusCheckedOut')}</option>
          <option value="auto_closed">{t('admin.statusAutoClosed')}</option>
        </select>
        <button type="submit" className="px-4 py-2 bg-[#1e3a5f] text-white text-sm rounded-lg hover:bg-[#2c4f7c]">
          {t('admin.search')}
        </button>
      </form>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-[#f0f2f5] border-b border-gray-200">
            <tr>
              <th className="text-left px-3 py-2 text-gray-500 font-medium whitespace-nowrap">{t('admin.visitor')}</th>
              <th className="text-left px-3 py-2 text-gray-500 font-medium">{t('admin.company')}</th>
              <th className="text-left px-3 py-2 text-gray-500 font-medium whitespace-nowrap">{t('admin.purpose')}</th>
              <th className="text-left px-3 py-2 text-gray-500 font-medium whitespace-nowrap">{t('admin.store')}</th>
              <th className="text-left px-3 py-2 text-gray-500 font-medium whitespace-nowrap">{t('admin.checkInTime')}</th>
              <th className="text-left px-3 py-2 text-gray-500 font-medium whitespace-nowrap">{t('admin.checkOutTime')}</th>
              <th className="text-left px-3 py-2 text-gray-500 font-medium">{t('admin.status')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">{t('common.loading')}</td></tr>
            ) : visits.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">{t('admin.noVisits')}</td></tr>
            ) : (
              visits.map(visit => (
                <tr key={visit.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/admin/visits/${visit.id}`} className="font-medium text-[#1e3a5f] hover:underline">
                      {visit.visitors?.name}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-gray-600 max-w-[160px] truncate">{visit.visitors?.company}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{visit.purpose}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{visit.stores?.name}</td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                    {new Date(visit.check_in_at).toLocaleString(dateLocale, {
                      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                    })}
                  </td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                    {visit.check_out_at
                      ? new Date(visit.check_out_at).toLocaleString(dateLocale, {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                        })
                      : '—'}
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={visit.status} t={t} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1 mt-4">
          <button
            onClick={() => fetchVisits(Math.max(1, page - 1))}
            disabled={page === 1}
            className="px-2 py-1 rounded text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-30"
          >
            ‹
          </button>
          {(() => {
            // 前後2ページ + 最初・最後を常に表示
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
                  onClick={() => fetchVisits(p as number)}
                  className={`px-2.5 py-1 rounded text-sm ${p === page ? 'bg-[#1e3a5f] text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  {p}
                </button>
              )
            )
          })()}
          <button
            onClick={() => fetchVisits(Math.min(totalPages, page + 1))}
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
