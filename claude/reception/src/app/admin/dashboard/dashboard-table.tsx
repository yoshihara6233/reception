'use client'

import Link from 'next/link'
import { useLocale } from '@/lib/i18n/useLocale'

interface RecentVisit {
  id: string
  purpose: string
  status: string
  check_in_at: string
  visitors: { company: string; name: string } | null
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

export function DashboardTable({ recentVisits }: { recentVisits: RecentVisit[] }) {
  const { t, locale } = useLocale()
  const dateLocale = locale === 'zh' ? 'zh-CN' : locale === 'ko' ? 'ko-KR' : locale === 'en' ? 'en-US' : 'ja-JP'

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-[#1e3a5f]">{t('admin.recentVisits')}</h2>
      </div>
      {recentVisits.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          {t('admin.noVisits')}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-[#f0f2f5] border-b border-gray-200">
            <tr>
              <th className="text-left px-6 py-3 text-gray-500 font-medium">{t('admin.visitor')}</th>
              <th className="text-left px-6 py-3 text-gray-500 font-medium">{t('admin.company')}</th>
              <th className="text-left px-6 py-3 text-gray-500 font-medium">{t('admin.purpose')}</th>
              <th className="text-left px-6 py-3 text-gray-500 font-medium">{t('admin.checkInTime')}</th>
              <th className="text-left px-6 py-3 text-gray-500 font-medium">{t('admin.status')}</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody>
            {recentVisits.map((visit) => (
              <tr key={visit.id} className="border-b border-gray-50 hover:bg-gray-50">
                <td className="px-6 py-3 font-medium text-[#1e3a5f]">
                  {visit.visitors?.name}
                </td>
                <td className="px-6 py-3 text-gray-600">
                  {visit.visitors?.company}
                </td>
                <td className="px-6 py-3 text-gray-600">{visit.purpose}</td>
                <td className="px-6 py-3 text-gray-500 text-xs">
                  {new Date(visit.check_in_at).toLocaleString(dateLocale, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                  })}
                </td>
                <td className="px-6 py-3">
                  <StatusBadge status={visit.status} t={t} />
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/visits/${visit.id}`}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-[#1e3a5f] bg-[#f0f2f5] hover:bg-[#e2e8f0] transition-colors"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    {t('admin.edit') || '詳細'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
