'use client'

import Link from 'next/link'

interface BaggageAlert {
  id: string
  context: 'checkin' | 'checkout'
  status: 'pending' | 'flagged'
  created_at: string
  visit_id: string
  visits: {
    id: string
    visitors: { company: string; name: string } | null
  } | null
}

export function BaggageAlerts({ alerts }: { alerts: BaggageAlert[] }) {
  const flagged = alerts.filter(a => a.status === 'flagged')
  const pending = alerts.filter(a => a.status === 'pending')

  return (
    <div className="mb-8">
      <div className={`rounded-2xl border-2 p-5 ${flagged.length > 0 ? 'border-red-200 bg-red-50' : 'border-yellow-200 bg-yellow-50'}`}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xl">{flagged.length > 0 ? '🚩' : '📋'}</span>
          <h2 className="font-semibold text-[var(--ge-accent)]">
            受付未監査
            {flagged.length > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-red-500 text-white rounded-full">
                フラグ {flagged.length}件
              </span>
            )}
            {pending.length > 0 && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-500 text-white rounded-full">
                未審査 {pending.length}件
              </span>
            )}
          </h2>
        </div>

        <div className="space-y-2">
          {alerts.map(alert => {
            const visitor = alert.visits?.visitors
            const contextLabel = alert.context === 'checkin' ? '入室' : '退室'
            const time = new Date(alert.created_at).toLocaleString('ja-JP', {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            })
            return (
              <Link
                key={alert.id}
                href={`/admin/visits/${alert.visit_id}`}
                className="flex items-center justify-between px-4 py-2.5 bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow group"
              >
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${alert.status === 'flagged' ? 'bg-red-500' : 'bg-yellow-400'}`} />
                  <div>
                    <p className="text-sm font-medium text-[var(--ge-accent)]">
                      {visitor ? `${visitor.company} ${visitor.name}` : '—'}
                    </p>
                    <p className="text-xs text-gray-400">{contextLabel}時 · {time}</p>
                  </div>
                </div>
                <span className="text-xs text-[var(--ge-accent)]/50 group-hover:text-[var(--ge-accent)] transition-colors">
                  詳細 →
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
