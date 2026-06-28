'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useLang } from '@/lib/i18n/context'
import { LangSwitcher } from './LangSwitcher'
import { ThemeToggle } from './ThemeToggle'
import { LogoutButton } from './LogoutButton'
import { ServerClock } from './ServerClock'

// F25: userName / avatar はフッターの StatusBar に移動したので、ここでは表示しない。
// プロップは互換性のためそのまま受領（残置）するが、UI には出さない。
export function AppHeader({
  userName: _userName,
  onMenuClick,
}: {
  userName?: string
  onMenuClick?: () => void
}) {
  const pathname    = usePathname() ?? ''
  const { t }       = useLang()

  // PWA(スタンドアロン起動)では設定(/admin)を出さない。現場オペレータ向けの
  // アプリ画面では設定を触らせず、設定はPC/ブラウザから行う方針。
  const [standalone, setStandalone] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(display-mode: standalone)')
    const update = () =>
      setStandalone(
        mq.matches ||
          (window.navigator as Navigator & { standalone?: boolean }).standalone === true,
      )
    update()
    mq.addEventListener?.('change', update)
    return () => mq.removeEventListener?.('change', update)
  }, [])

  const TABS = [
    { href: '/stores',   label: t.nav.monitor  },
    { href: '/infra',    label: t.nav.infra    },
    { href: '/bcp',      label: t.nav.bcp      },
    { href: '/security', label: t.nav.security },
    { href: '/factory',  label: t.nav.factory  },
    // F23: /logs タブは削除（マスタ内の監査ログと重複していたため）
    // F24: /admin（設定）は中央タブから外し、右側のアイコンに移動
  ]

  // F24: settings tab is now an icon — active highlight when the user is
  // anywhere under /admin.
  const settingsActive = pathname === '/admin' || pathname.startsWith('/admin/')

  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-3 py-2 text-slate-100 md:px-4">
      {/* Left: hamburger (mobile) + logo */}
      <div className="flex items-center gap-2">
        {onMenuClick && (
          <button
            onClick={onMenuClick}
            className="flex h-8 w-8 items-center justify-center rounded text-slate-300 hover:bg-slate-800 md:hidden"
            aria-label="メニューを開く"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6"  x2="21" y2="6"/>
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
        )}

        {/* ロゴ押下でログイン後のTOP(/stores)へ戻る（PC・PWA共通） */}
        <Link
          href="/stores"
          aria-label={t.nav.monitor}
          className="flex items-center gap-2 rounded text-sm font-bold transition-opacity hover:opacity-80"
        >
          <span className="block h-[18px] w-[18px] flex-shrink-0 rounded bg-gradient-to-br from-blue-500 to-violet-500" />
          <div className="flex flex-col leading-tight">
            <span>
              <span className="hidden sm:inline">Recorder {t.appName}</span>
              <span className="sm:hidden">{t.appName}</span>
            </span>
            {/* F66: ロゴ直下にサーバ時刻を常時表示 */}
            <ServerClock />
          </div>
        </Link>
      </div>

      {/* Center: tab nav — desktop only */}
      <nav className="hidden gap-1 text-xs md:flex">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + '/')
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={
                'rounded px-3 py-1 ' +
                (active
                  ? 'bg-slate-800 text-white font-semibold'
                  : 'text-slate-300 hover:bg-slate-800/60')
              }
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>

      {/* Right: theme toggle + language switcher + settings icon + user + logout */}
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <LangSwitcher />
        {/* F24: settings (旧 マスタ) は中央タブから右側のアイコンへ移動。
            PWA(スタンドアロン)では非表示。 */}
        {!standalone && (
          <Link
            href="/admin"
            aria-label={t.nav.admin}
            title={t.nav.admin}
            className={
              'flex h-8 w-8 items-center justify-center rounded-lg transition-colors ' +
              (settingsActive
                ? 'bg-slate-800 text-white'
                : 'text-slate-300 hover:bg-white/10 hover:text-white')
            }
          >
            {/* Gear icon */}
            <svg
              width="18" height="18" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
        )}
        {/* F25: userName + avatar は StatusBar に移行 */}
        {/* F24: logout — rightmost */}
        <LogoutButton />
      </div>
    </header>
  )
}
