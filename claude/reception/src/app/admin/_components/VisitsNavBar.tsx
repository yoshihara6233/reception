'use client'

/**
 * 来訪管理ページ共通ナビゲーションバー
 *
 * テーブル / タイムライン / アンマッチ確認 / 手荷物レビュー
 * の 4 タブを各ページに統一して表示する。
 */

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

type Tab = {
  key: string
  href: string
  label: string
  icon: string
  variant: 'normal' | 'warning'
}

const TABS: Tab[] = [
  { key: 'table',          href: '/admin/visits',           label: 'テーブル',       icon: '📋', variant: 'normal'  },
  { key: 'timeline',       href: '/admin/visits?view=timeline', label: 'タイムライン', icon: '⏱', variant: 'normal'  },
  { key: 'mismatch',       href: '/admin/visits/mismatch',  label: 'アンマッチ確認', icon: '⚠️', variant: 'warning' },
  { key: 'baggage-review', href: '/admin/baggage/review',   label: '手荷物レビュー', icon: '🔍', variant: 'normal'  },
]

export function VisitsNavBar() {
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const view         = searchParams.get('view')

  function isActive(tab: Tab): boolean {
    if (tab.key === 'table')          return pathname === '/admin/visits' && view !== 'timeline'
    if (tab.key === 'timeline')       return pathname === '/admin/visits' && view === 'timeline'
    if (tab.key === 'mismatch')       return pathname === '/admin/visits/mismatch'
    if (tab.key === 'baggage-review') return pathname.startsWith('/admin/baggage/review')
    return false
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {TABS.map(tab => {
        const active = isActive(tab)

        if (tab.variant === 'warning') {
          return (
            <Link
              key={tab.key}
              href={tab.href}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 12px', borderRadius: 4,
                font: '500 11px/1 var(--font-sans)',
                color: active ? '#fff' : '#b91c1c',
                background: active ? '#b91c1c' : '#fef2f2',
                border: `1px solid ${active ? '#b91c1c' : '#fecaca'}`,
                textDecoration: 'none',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {tab.icon} {tab.label}
            </Link>
          )
        }

        return (
          <Link
            key={tab.key}
            href={tab.href}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '5px 12px', borderRadius: 4,
              font: '500 11px/1 var(--font-sans)',
              color: active ? '#fff' : 'var(--ge-ink-2)',
              background: active ? 'var(--ge-accent)' : '#fff',
              border: `1px solid ${active ? 'var(--ge-accent)' : 'var(--ge-line)'}`,
              textDecoration: 'none',
              transition: 'background 0.15s, color 0.15s',
            }}
          >
            {tab.icon} {tab.label}
          </Link>
        )
      })}
    </div>
  )
}
