'use client'

import Link from 'next/link'
import { useLocale, type Locale } from '@/lib/i18n/useLocale'
import { LogoutButton } from './logout-button'

const navKeys = [
  { href: '/admin/dashboard', key: 'dashboard', icon: '📊' },
  { href: '/admin/visits', key: 'visits', icon: '📋' },
  { href: '/admin/analytics', key: 'analytics', icon: '📈' },
  { href: '/admin/stores', key: 'stores', icon: '🏪' },
  { href: '/admin/settings', key: 'settings', icon: '⚙️' },
  { href: '/admin/settings/staff', key: 'staff', icon: '👤' },
  { href: '/admin/settings/consent', key: 'consent', icon: '📝' },
  { href: '/admin/users', key: 'users', icon: '👥' },
] as const

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'ja', label: '日本語' },
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文' },
  { value: 'ko', label: '한국어' },
]

export function AdminSidebar() {
  const { locale, setLocale, t } = useLocale()

  return (
    <aside className="w-64 bg-[#1e3a5f] fixed h-full flex flex-col">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">&#x1F6E1;</span>
          <h1 className="text-lg font-bold text-white">Reception Kiosk</h1>
        </div>
        <p className="text-xs text-white/40 ml-7">{t('admin.title')}</p>
      </div>
      <nav className="px-3 flex-1">
        {navKeys.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 px-3 py-2.5 text-sm text-white/70 rounded-lg hover:bg-white/10 hover:text-white transition-colors"
          >
            <span>{item.icon}</span>
            {t(`admin.${item.key}`)}
          </Link>
        ))}
      </nav>

      {/* Language picker */}
      <div className="px-3 pb-2">
        <select
          value={locale}
          onChange={e => setLocale(e.target.value as Locale)}
          className="w-full px-3 py-2 bg-white/10 text-white/70 text-xs rounded-lg border border-white/10 focus:outline-none focus:ring-1 focus:ring-white/30 hover:bg-white/15 transition-colors"
        >
          {LOCALES.map(l => (
            <option key={l.value} value={l.value} className="bg-[#1e3a5f] text-white">
              {l.label}
            </option>
          ))}
        </select>
      </div>

      <div className="p-3 border-t border-white/10">
        <LogoutButton />
      </div>
    </aside>
  )
}
