'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLang } from '@/lib/i18n/context'

export function BottomNav() {
  const pathname = usePathname() ?? ''
  const { t }    = useLang()

  const TABS = [
    {
      href: '/stores',
      label: t.nav.monitor,
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
      ),
    },
    {
      href: '/map',
      label: t.nav.map,
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
          <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
          <line x1="9" y1="3" x2="9" y2="18"/>
          <line x1="15" y1="6" x2="15" y2="21"/>
        </svg>
      ),
    },
    {
      href: '/bcp',
      label: t.nav.bcp,
      icon: (active: boolean) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <path d="M12 8v4"/>
          <path d="M12 16h.01"/>
        </svg>
      ),
    },
    // 設定(admin) はスマホ/PWA では非表示。設定は PC/ブラウザのヘッダーから行う。
  ]

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex h-14 items-stretch border-t border-slate-800 bg-slate-900 md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] transition-colors ' +
              (active ? 'text-blue-400' : 'text-slate-400 hover:text-slate-200')
            }
          >
            {tab.icon(active)}
            <span className="leading-none">{tab.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
