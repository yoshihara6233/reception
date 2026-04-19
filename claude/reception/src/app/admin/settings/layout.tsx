'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/admin/settings',               label: '受付設定',  icon: '⚙️'  },
  { href: '/admin/settings/notifications', label: '通知設定',  icon: '🔔'  },
  { href: '/admin/settings/webhooks',      label: 'Webhook',   icon: '🔗'  },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div>
      {/* サブタブ */}
      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {TABS.map(tab => {
          // 正確一致（notifications/webhooksは前方一致しないように）
          const active = tab.href === '/admin/settings'
            ? pathname === '/admin/settings'
            : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                active
                  ? 'border-[#1e3a5f] text-[#1e3a5f]'
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
