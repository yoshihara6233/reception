'use client'

import Link from 'next/link'
import { usePathname, useParams } from 'next/navigation'
import { useSiteConfig } from '@/lib/site-config'

export default function StoreDetailLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>()
  const pathname = usePathname()
  const { locationName } = useSiteConfig()

  const TABS = [
    { suffix: '',                   icon: '🏪', label: `${locationName}情報`, exact: true },
    { suffix: '/staff',             icon: '👤', label: 'スタッフ' },
    { suffix: '/notifications',     icon: '🔔', label: '通知設定' },
    { suffix: '/webhooks',          icon: '🔗', label: 'Webhook' },
    { suffix: '/cameras',           icon: '📹', label: 'カメラ接続' },
    { suffix: '/pre-registrations', icon: '🎫', label: '来客登録' },
  ]
  const base = `/admin/stores/${params.id}`

  return (
    <div>
      {/* タブナビ */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map(tab => {
          const href = base + tab.suffix
          const active = tab.exact ? pathname === href : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                active
                  ? 'border-[var(--ge-accent)] text-[var(--ge-accent)]'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </Link>
          )
        })}
      </div>
      {children}
    </div>
  )
}
