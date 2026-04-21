'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocale, type Locale } from '@/lib/i18n/useLocale'
import { LogoutButton } from './logout-button'
import { useEffect, useState } from 'react'
import { useSiteConfig } from '@/lib/site-config'
import { useAdminAccess } from '@/lib/admin-access'
import { canAccess } from '@/lib/acl'
import {
  LayoutDashboard, ClipboardList, Briefcase,
  Building2, Settings, Users, ScrollText, BookOpen,
  FileText,
} from 'lucide-react'

// ── 型 ──────────────────────────────────────────────────────────────────────

type SectionKey = 'management' | 'settings' | 'manual'

type NavItem = {
  href: string
  icon: React.ReactNode
  label: string | ((loc: string) => string)
  exact?: boolean
  badgeKey?: string
}

// ── 1行目に直接並べるオペレーションリンク ────────────────────────────────────

const OP_LINKS: NavItem[] = [
  { href: '/admin/dashboard', icon: <LayoutDashboard size={14} strokeWidth={1.5} />, label: 'ダッシュボード', exact: true },
  { href: '/admin/visits',    icon: <ClipboardList   size={14} strokeWidth={1.5} />, label: '来訪履歴' },
  { href: '/admin/baggage',   icon: <Briefcase       size={14} strokeWidth={1.5} />, label: '手荷物検査', badgeKey: 'baggage' },
]

const OP_PATHS = ['/admin/dashboard', '/admin/visits', '/admin/baggage']

// ── セクション（サブナビあり） ────────────────────────────────────────────────

const SECTION_PATHS: Record<SectionKey, string[]> = {
  management: ['/admin/stores', '/admin/pre-registrations'],
  settings:   ['/admin/settings', '/admin/users', '/admin/logs'],
  manual:     ['/admin/manual'],
}

const SECTION_META: Record<SectionKey, { label: (loc: string) => string }> = {
  management: { label: loc => `${loc}管理` },
  settings:   { label: () => '設定' },
  manual:     { label: () => 'マニュアル' },
}

const SUB_NAV: Record<SectionKey, NavItem[]> = {
  management: [
    { href: '/admin/stores', icon: <Building2 size={14} strokeWidth={1.5} />, label: loc => `${loc}一覧` },
  ],
  settings: [
    { href: '/admin/settings',         icon: <Settings   size={14} strokeWidth={1.5} />, label: '受付設定', exact: true },
    { href: '/admin/settings/consent', icon: <FileText   size={14} strokeWidth={1.5} />, label: '同意書テンプレート' },
    { href: '/admin/users',            icon: <Users      size={14} strokeWidth={1.5} />, label: 'ユーザー管理' },
    { href: '/admin/logs',             icon: <ScrollText size={14} strokeWidth={1.5} />, label: '操作ログ' },
  ],
  manual: [
    { href: '/admin/manual', icon: <BookOpen size={14} strokeWidth={1.5} />, label: '操作マニュアル', exact: true },
  ],
}

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'ja', label: 'JP' },
  { value: 'en', label: 'EN' },
  { value: 'zh', label: 'ZH' },
  { value: 'ko', label: 'KO' },
]

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href
  return pathname === href || pathname.startsWith(href + '/')
}

function resolveLabel(label: string | ((loc: string) => string), loc: string): string {
  return typeof label === 'function' ? label(loc) : label
}

// ── コンポーネント ────────────────────────────────────────────────────────────

export function AdminTopNav() {
  const { locale, setLocale } = useLocale()
  const pathname = usePathname()
  const { locationName } = useSiteConfig()
  const { role, name, email } = useAdminAccess()
  const [baggageCount, setBaggageCount] = useState(0)
  const isLogin = pathname === '/admin/login'

  // どのセクションにいるか（オペレーションリンクはnull）
  const currentSection: SectionKey | null =
    (Object.entries(SECTION_PATHS) as [SectionKey, string[]][]).find(([, paths]) =>
      paths.some(p => pathname === p || pathname.startsWith(p + '/'))
    )?.[0] ?? null

  const subNavItems = currentSection ? SUB_NAV[currentSection] : null

  // 手荷物バッジ
  useEffect(() => {
    if (isLogin) return
    fetch('/api/v1/admin/baggage-count')
      .then(r => r.json())
      .then(d => setBaggageCount(d.count ?? 0))
      .catch(() => {})
  }, [pathname, isLogin])

  if (isLogin) return null

  const linkStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '0 14px', height: '100%',
    font: '500 13px/1 var(--font-sans)',
    color: active ? 'var(--ge-accent-ink)' : 'var(--ge-ink-3)',
    background: 'transparent',
    textDecoration: 'none', whiteSpace: 'nowrap',
    borderBottom: active ? '2px solid var(--ge-accent)' : '2px solid transparent',
    transition: 'color 120ms var(--ge-ease), border-color 120ms var(--ge-ease)',
  })

  return (
    <>
      {/* ── 1行目 ───────────────────────────────────────────────────── */}
      <header style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        background: '#fff',
        borderBottom: '1px solid var(--ge-line)',
        height: 52,
        display: 'flex', alignItems: 'stretch', padding: '0 16px',
        overflow: 'hidden',
      }}>
        {/* Logo */}
        <Link
          href="/admin/dashboard"
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            textDecoration: 'none', marginRight: 20, flexShrink: 0,
            borderBottom: 'none', whiteSpace: 'nowrap',
          }}
        >
          {/* Genesis Edge symbol */}
          <span style={{
            width: 26, height: 26, borderRadius: 5, flexShrink: 0, overflow: 'hidden',
            background: 'var(--ge-paper-2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg viewBox="4 4 56 56" width="20" height="20" aria-hidden="true">
              <path d="M6 6 H58 V40 L40 58 H6 Z" fill="#0F0F10"/>
              <path d="M40 58 L40 40 L58 40 Z" fill="#2C4A7E"/>
            </svg>
          </span>
          <span style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ font: '700 11px/1 var(--font-sans)', color: 'var(--ge-ink)', whiteSpace: 'nowrap' }}>
              ジェネシス・エッジ
            </span>
            <span style={{ font: '500 9px/1 var(--font-mono)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ge-ink-4)', marginTop: 3, whiteSpace: 'nowrap' }}>
              Reception
            </span>
          </span>
        </Link>

        {/* オペレーションリンク（直接） */}
        <nav style={{ display: 'flex', alignItems: 'stretch', height: '100%' }}>
          {OP_LINKS.map(item => {
            const active = isActive(pathname, item.href, item.exact)
            const allowed = canAccess(role, item.href)
            const label = resolveLabel(item.label, locationName)
            const count = item.badgeKey === 'baggage' ? baggageCount : 0
            if (!allowed) return null
            return (
              <Link key={item.href} href={item.href} style={linkStyle(active)}>
                {item.icon}
                {label}
                {count > 0 && (
                  <span style={{
                    background: 'var(--ge-danger)', color: '#fff',
                    font: '600 10px/1 var(--font-mono)',
                    borderRadius: 999, minWidth: 16, height: 16,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 4px', marginLeft: 2,
                  }}>
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* 区切り */}
        <div style={{ width: 1, background: 'var(--ge-line)', margin: '12px 8px', flexShrink: 0 }} />

        {/* セクションタブ（管理/設定/マニュアル） */}
        <nav style={{ display: 'flex', alignItems: 'stretch', height: '100%', flex: 1 }}>
          {(Object.keys(SECTION_META) as SectionKey[]).map(key => {
            const meta = SECTION_META[key]
            const active = key === currentSection
            const firstVisible = SUB_NAV[key].find(item => canAccess(role, item.href))
            const href = firstVisible?.href ?? SUB_NAV[key][0].href
            return (
              <Link key={key} href={href} style={linkStyle(active)}>
                {meta.label(locationName)}
              </Link>
            )
          })}
        </nav>

        {/* ユーザー */}
        {name && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '0 8px 0 4px', borderRadius: 999,
            background: 'var(--ge-paper-2)', flexShrink: 0, marginRight: 8, alignSelf: 'center',
            whiteSpace: 'nowrap', height: 28,
          }} title={email}>
            <span style={{
              width: 20, height: 20, borderRadius: 999,
              background: 'var(--ge-accent)', color: '#fff',
              font: '600 10px/1 var(--font-mono)', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              {name.slice(0, 1).toUpperCase()}
            </span>
            <span style={{ font: '500 12px/1 var(--font-sans)', color: 'var(--ge-ink)' }}>{name}</span>
          </div>
        )}

        {/* 言語 */}
        <select
          value={locale}
          onChange={e => setLocale(e.target.value as Locale)}
          style={{
            padding: '4px 6px', borderRadius: 4, flexShrink: 0, alignSelf: 'center',
            background: 'var(--ge-paper-2)', color: 'var(--ge-ink-3)',
            border: '1px solid var(--ge-line)',
            font: '500 11px/1 var(--font-mono)', letterSpacing: '0.05em',
            cursor: 'pointer', marginRight: 8,
          }}
        >
          {LOCALES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>

        {/* ログアウト */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <LogoutButton compact />
        </div>
      </header>

      {/* ── 2行目（サブナビ）：セクション内のみ表示 ────────────────────── */}
      {subNavItems && (
        <nav style={{
          position: 'fixed', top: 52, left: 0, right: 0, zIndex: 40,
          background: 'var(--ge-paper)',
          borderBottom: '1px solid var(--ge-line)',
          height: 40,
          display: 'flex', alignItems: 'stretch', padding: '0 16px',
          overflow: 'hidden',
        }}>
          {subNavItems.map(item => {
            const active = isActive(pathname, item.href, item.exact)
            const allowed = canAccess(role, item.href)
            const label = resolveLabel(item.label, locationName)

            if (!allowed) {
              return (
                <span
                  key={item.href}
                  title="権限がありません"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '0 12px',
                    font: '500 13px/1 var(--font-sans)',
                    color: 'var(--ge-ink-4)', cursor: 'not-allowed',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.icon}
                  {label}
                </span>
              )
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '0 12px',
                  font: '500 13px/1 var(--font-sans)',
                  color: active ? 'var(--ge-accent-ink)' : 'var(--ge-ink-3)',
                  background: 'transparent',
                  textDecoration: 'none', whiteSpace: 'nowrap',
                  borderBottom: active ? '2px solid var(--ge-accent)' : '2px solid transparent',
                  transition: 'color 120ms var(--ge-ease), border-color 120ms var(--ge-ease)',
                }}
              >
                {item.icon}
                {label}
              </Link>
            )
          })}
        </nav>
      )}
    </>
  )
}
