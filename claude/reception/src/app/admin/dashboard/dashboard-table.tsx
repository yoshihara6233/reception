'use client'

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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
