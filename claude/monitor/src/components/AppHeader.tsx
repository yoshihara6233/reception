'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useLang } from '@/lib/i18n/context'
import { LangSwitcher } from './LangSwitcher'
import { ThemeToggle } from './ThemeToggle'
import { LogoutButton } from './LogoutButton'
import { ServerClock } from './ServerClock'
import { MonitorMark } from './MonitorMark'

// F25: userName / avatar はフッターの StatusBar に移動したので、ここでは表示しない。
// プロップは互換性のためそのまま受領（残置）するが、UI には出さない。
export function AppHeader({
  userName: _userName,
  onMenuClick,
  features,
  tenantName,
  isSuper,
}: {
  userName?: string
  onMenuClick?: () => void
  // テナントのオプション機能フラグ。未指定は全表示（後方互換・フェイルオープン）。
  features?: { patrol: boolean; alarm: boolean; baggage: boolean }
  // 操作中/所属テナント名。super_admin 未選択時は null。
  tenantName?: string | null
  isSuper?: boolean
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

  // 未完了（未対応/対応中）の発報があれば ALARM タブを赤字にする。軽量ポーリング（45秒）＋
  // 画面遷移時に再取得。RLS 越しなので閲覧可能店舗の発報のみ数える。
  const [openAlarms, setOpenAlarms] = useState(0)
  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const r = await fetch('/api/alarms/open-count', { cache: 'no-store' })
        if (!r.ok) return
        const j = await r.json()
        if (active) setOpenAlarms(Number(j.count) || 0)
      } catch { /* オフライン等は無視 */ }
    }
    load()
    const timer = setInterval(load, 45_000)
    return () => { active = false; clearInterval(timer) }
  }, [pathname])

  // オプション機能フラグで出し分け。未指定(=undefined)は全表示（フェイルオープン）。
  // 巡回=/security・発報=/alarms・検査=/baggage は有料オプションのため、
  // テナントで無効なら中央タブから隠す。/stores・/bcp・/infra は基本パック＝常時表示。
  const TABS: Array<{ href: string; label: string; base?: string }> = [
    { href: '/stores',   label: t.nav.monitor  },
    { href: '/bcp',      label: t.nav.bcp      },
    // PATROL の着地は巡回レポート（利用頻度が最も高い）。ハイライトは /security 配下全体。
    ...(features?.patrol !== false
      ? [{ href: '/security/reports', label: t.nav.security, base: '/security' }] : []),
    ...(features?.alarm !== false
      ? [{ href: '/alarms', label: 'ALARM' }] : []),
    // 手荷物検査モジュール（M4）。ラベルは ALARM と同様に固定表記。
    ...(features?.baggage !== false
      ? [{ href: '/baggage', label: '検査' }] : []),
    // 死活監視(/infra)は SaaS 運営者向け＝中央タブから外し、②運営管理（/admin）へ移動。
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
          className="flex items-center gap-2 rounded px-1 py-0.5 text-sm font-bold transition-colors hover:bg-white/10"
        >
          <MonitorMark className="h-[22px] w-[22px] flex-shrink-0 text-white" accent="#6A90C8" />
          <div className="flex flex-col leading-tight">
            <span>
              <span className="hidden sm:inline">Recorder {t.appName}</span>
              <span className="sm:hidden">{t.appName}</span>
            </span>
            {/* F66: ロゴ直下にサーバ時刻を常時表示 */}
            <ServerClock />
          </div>
        </Link>

        {/* 操作中/所属テナント名バッジ（ロゴ右横）。super_admin 未選択は灰色で明示。 */}
        {tenantName ? (
          <span
            className="ml-1 max-w-[9rem] truncate rounded bg-[#2C4A7E] px-2 py-0.5 text-[11px] font-semibold text-white sm:max-w-[14rem]"
            title={`テナント: ${tenantName}`}
          >
            {tenantName}
          </span>
        ) : isSuper ? (
          <span
            className="ml-1 rounded border border-slate-600 px-2 py-0.5 text-[11px] font-medium text-slate-400"
            title="操作中テナント未選択"
          >
            テナント未選択
          </span>
        ) : null}
      </div>

      {/* Center: tab nav — desktop only */}
      <nav aria-label="モジュール" className="hidden gap-1 text-xs md:flex">
        {TABS.map((tab) => {
          const base   = tab.base ?? tab.href
          const active = pathname === base || pathname.startsWith(base + '/')
          // 未完了の発報がある時、ALARM タブは赤字で注意喚起（active/inactive とも赤を優先）。
          const alarmOpen = tab.href === '/alarms' && openAlarms > 0
          const cls = active
            ? (alarmOpen ? 'bg-slate-800 text-red-400 font-semibold' : 'bg-slate-800 text-white font-semibold')
            : (alarmOpen ? 'text-red-400 font-semibold hover:bg-slate-800/60' : 'text-slate-300 hover:bg-slate-800/60')
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={'rounded px-3 py-1 ' + cls}
            >
              {tab.label}
              {alarmOpen && <span className="ml-1 tabular-nums">({openAlarms})</span>}
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
