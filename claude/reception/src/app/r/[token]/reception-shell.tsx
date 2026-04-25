'use client'

/**
 * 受付画面 共通シェル
 * 入室・退室のどちらでも使えるカード選択UI
 */

import React from 'react'

// ── カラーテーマ ─────────────────────────────────────────────────────────────

export const THEME = {
  checkin: {
    accent:     '#1a56db',
    accentSoft: '#eff4ff',
    accentLine: '#c3d3f5',
    accentText: '#1a3a7a',
    bar:        'linear-gradient(135deg,#1e3a5f 0%,#1a56db 100%)',
    label:      '入室',
    labelEn:    'Check In',
  },
  checkout: {
    accent:     '#0d7c66',
    accentSoft: '#edfcf2',
    accentLine: '#a6e4c8',
    accentText: '#065f46',
    bar:        'linear-gradient(135deg,#065f46 0%,#0d9488 100%)',
    label:      '退室',
    labelEn:    'Check Out',
  },
} as const

export type ThemeKey = keyof typeof THEME

// ── SVG アイコン ────────────────────────────────────────────────────────────

export function FaceIcon({ size = 32, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="20" r="11" stroke={color} strokeWidth="2"/>
      <circle cx="19.5" cy="18.5" r="1.8" fill={color}/>
      <circle cx="28.5" cy="18.5" r="1.8" fill={color}/>
      <path d="M18.5 25c1.5 2.5 9.5 2.5 11 0" stroke={color} strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M8 44c0-9 7-15 16-15s16 6 16 15" stroke={color} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}

export function QrScanIcon({ size = 32, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
      {/* QRブロック 左上 */}
      <rect x="6" y="6" width="13" height="13" rx="2"/>
      <rect x="9" y="9" width="7" height="7" rx="1" fill={color} stroke="none"/>
      {/* QRブロック 右上 */}
      <rect x="29" y="6" width="13" height="13" rx="2"/>
      <rect x="32" y="9" width="7" height="7" rx="1" fill={color} stroke="none"/>
      {/* QRブロック 左下 */}
      <rect x="6" y="29" width="13" height="13" rx="2"/>
      <rect x="9" y="32" width="7" height="7" rx="1" fill={color} stroke="none"/>
      {/* ドット群 右下 */}
      <rect x="29" y="29" width="5" height="5" rx="1" fill={color} stroke="none"/>
      <rect x="36" y="29" width="6" height="5" rx="1" fill={color} stroke="none"/>
      <rect x="29" y="36" width="5" height="6" rx="1" fill={color} stroke="none"/>
      <rect x="36" y="36" width="6" height="6" rx="1" fill={color} stroke="none"/>
      {/* スキャンライン */}
      <line x1="4" y1="24" x2="44" y2="24" strokeDasharray="3 2" strokeOpacity="0.3"/>
    </svg>
  )
}

export function NewPersonIcon({ size = 32, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="20" cy="17" r="8"/>
      <path d="M4 44c0-9 7-14 16-14"/>
      <circle cx="36" cy="36" r="9"/>
      <line x1="36" y1="31" x2="36" y2="41"/>
      <line x1="31" y1="36" x2="41" y2="36"/>
    </svg>
  )
}

// ── 選択カード ──────────────────────────────────────────────────────────────

export type CardVariant = 'primary' | 'secondary' | 'ghost'

export function OptionCard({
  href, icon, label, sub, tag, variant, theme,
}: {
  href: string
  icon: React.ReactNode
  label: string
  sub: string
  tag?: string
  variant: CardVariant
  theme: typeof THEME[ThemeKey]
}) {
  const v = {
    primary: {
      bg: theme.accent, border: 'transparent',
      color: '#fff', iconBg: 'rgba(255,255,255,0.18)',
      subColor: 'rgba(255,255,255,0.65)',
      tagBg: 'rgba(255,255,255,0.2)', tagColor: '#fff',
      arrow: 'rgba(255,255,255,0.5)',
    },
    secondary: {
      bg: '#fff', border: theme.accentLine,
      color: theme.accentText, iconBg: theme.accentSoft,
      subColor: '#64748b',
      tagBg: theme.accentSoft, tagColor: theme.accent,
      arrow: '#cbd5e1',
    },
    ghost: {
      bg: '#f8fafc', border: '#e2e8f0',
      color: '#1e293b', iconBg: '#fff',
      subColor: '#94a3b8',
      tagBg: '#f1f5f9', tagColor: '#64748b',
      arrow: '#e2e8f0',
    },
  }[variant]

  return (
    <a
      href={href}
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '20px 18px',
        background: v.bg,
        border: `1.5px solid ${v.border}`,
        borderRadius: 14,
        textDecoration: 'none',
        color: v.color,
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {/* アイコン */}
      <span style={{
        width: 60, height: 60, borderRadius: 12, flexShrink: 0,
        background: v.iconBg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {icon}
      </span>

      {/* テキスト */}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ font: `700 17px/1.3 var(--font-sans)` }}>{label}</span>
          {tag && (
            <span style={{
              font: `600 10px/1 var(--font-mono)`, letterSpacing: '0.08em',
              padding: '3px 8px', borderRadius: 4,
              background: v.tagBg, color: v.tagColor,
            }}>{tag}</span>
          )}
        </span>
        <span style={{
          display: 'block', marginTop: 5,
          font: `400 12px/1.5 var(--font-sans)`,
          color: v.subColor,
        }}>{sub}</span>
      </span>

      {/* 矢印 */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke={v.arrow} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        style={{ flexShrink: 0 }}>
        <path d="M9 18l6-6-6-6"/>
      </svg>
    </a>
  )
}

// ── ページシェル ────────────────────────────────────────────────────────────

export function ReceptionShell({
  token, themeKey, locale, children, returningBanner,
}: {
  token: string
  themeKey: ThemeKey
  locale: string
  children: React.ReactNode
  returningBanner?: React.ReactNode
}) {
  const theme = THEME[themeKey]
  const ja = (j: string, e: string) => locale === 'ja' ? j : e

  return (
    <div style={{
      minHeight: '100svh',
      display: 'flex',
      flexDirection: 'column',
      background: '#f1f5f9',
      fontFamily: 'var(--font-sans)',
    }}>
      {/* カラーバー */}
      <div style={{ height: 4, background: theme.bar }} />

      {/* ヘッダー */}
      <header style={{
        background: '#fff',
        borderBottom: '1px solid #e2e8f0',
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
      }}>
        <a
          href={`/r/${token}`}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 34, height: 34, borderRadius: 8,
            background: '#f1f5f9',
            textDecoration: 'none', flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </a>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 style={{ font: `700 20px/1 var(--font-sans)`, margin: 0, color: '#0f172a' }}>
              {locale === 'ja' ? theme.label : theme.labelEn}
            </h1>
            <span style={{
              padding: '3px 10px', borderRadius: 20,
              font: `600 11px/1 var(--font-sans)`,
              background: theme.accentSoft, color: theme.accent,
              border: `1px solid ${theme.accentLine}`,
            }}>
              {ja('認証方法を選択', 'Select method')}
            </span>
          </div>
        </div>
      </header>

      {/* コンテンツ */}
      <main style={{ flex: 1, padding: '16px 16px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {returningBanner}
        {children}
      </main>

      {/* フッター */}
      <footer style={{
        borderTop: '1px solid #e2e8f0',
        padding: '10px 20px',
        background: '#fff',
        textAlign: 'center',
      }}>
        <span style={{
          font: `500 9px/1 var(--font-mono)`,
          letterSpacing: '0.14em', textTransform: 'uppercase', color: '#94a3b8',
        }}>
          Genesis Edge · Reception
        </span>
      </footer>
    </div>
  )
}

// ── リピーターバナー ────────────────────────────────────────────────────────

export function ReturningBanner({
  name, lastVisit, href, locale, theme,
}: {
  name: string; lastVisit: string | null; href: string; locale: string
  theme: typeof THEME[ThemeKey]
}) {
  const ja = (j: string, e: string) => locale === 'ja' ? j : e
  const fmt = (iso: string) => {
    const d = new Date(iso)
    return `${d.getMonth() + 1}/${d.getDate()}`
  }

  return (
    <a
      href={href}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 16px',
        background: theme.accentSoft,
        border: `1.5px solid ${theme.accentLine}`,
        borderRadius: 12,
        textDecoration: 'none',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{
          width: 38, height: 38, borderRadius: '50%',
          background: theme.accent, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          font: `700 16px/1 var(--font-sans)`, flexShrink: 0,
        }}>
          {name.slice(0, 1)}
        </span>
        <div>
          <p style={{ font: `600 13px/1.3 var(--font-sans)`, color: theme.accentText, margin: 0 }}>
            {name}{ja(' さん', '')}
          </p>
          {lastVisit && (
            <p style={{ font: `400 11px/1 var(--font-mono)`, color: '#64748b', marginTop: 3 }}>
              {ja(`前回: ${fmt(lastVisit)}`, `Last: ${fmt(lastVisit)}`)}
            </p>
          )}
        </div>
      </div>
      <span style={{
        font: `600 11px/1 var(--font-sans)`,
        padding: '7px 14px', borderRadius: 8,
        background: theme.accent, color: '#fff',
        whiteSpace: 'nowrap', flexShrink: 0,
      }}>
        {ja('前回の情報で →', 'Quick →')}
      </span>
    </a>
  )
}
