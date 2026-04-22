'use client'

import Link from 'next/link'

interface LongStayVisitor {
  id: string; name: string; company: string; store: string; hours: number
}

interface Props {
  currentVisitors: number
  todayVisits: number
  pendingBaggage: number
  longStayCount: number
  longStayVisitors: LongStayVisitor[]
}

// ── SVG アイコン（絵文字なし） ────────────────────────────────────────────────

function IconPeople() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M3 13c0-2.761 2.239-5 5-5s5 2.239 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function IconClipboard() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="10" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M6 3V2.5A1.5 1.5 0 0 1 7.5 1h1A1.5 1.5 0 0 1 10 2.5V3" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M6 8h4M6 10.5h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function IconBaggage() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="6" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M5.5 6V4.5A1.5 1.5 0 0 1 7 3h2a1.5 1.5 0 0 1 1.5 1.5V6" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M8 9v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  )
}

function IconClock() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.5"/>
      <path d="M8 5v3.5l2 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// ── KPI カード ────────────────────────────────────────────────────────────────

function MetricCard({
  icon, label, value, unit, alert, href,
  accentColor = 'var(--ge-accent)',
}: {
  icon: React.ReactNode
  label: string
  value: number
  unit: string
  alert?: boolean
  href?: string
  accentColor?: string
}) {
  const content = (
    <div style={{
      background: '#fff',
      border: `1px solid ${alert ? 'var(--ge-danger-soft)' : 'var(--ge-line)'}`,
      borderRadius: 6,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      position: 'relative',
      cursor: href ? 'pointer' : 'default',
      transition: 'box-shadow 120ms var(--ge-ease)',
    }}>
      {/* ラベル行 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          color: alert ? 'var(--ge-danger)' : 'var(--ge-ink-3)',
        }}>
          {icon}
          <span style={{
            font: '500 11px/1 var(--ge-font-latin)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            {label}
          </span>
        </div>
        {alert && (
          <span style={{
            width: 7, height: 7, borderRadius: 999,
            background: 'var(--ge-danger)',
            boxShadow: '0 0 0 3px var(--ge-danger-soft)',
            flexShrink: 0,
          }} />
        )}
      </div>

      {/* 数値行 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{
          fontFamily: 'var(--ge-font-mono)',
          fontVariantNumeric: 'tabular-nums',
          fontSize: 28,
          fontWeight: 500,
          lineHeight: 1,
          color: alert ? 'var(--ge-danger)' : 'var(--ge-ink)',
          letterSpacing: '-0.02em',
        }}>
          {value.toLocaleString()}
        </span>
        <span style={{
          font: '400 12px/1 var(--ge-font-jp)',
          color: 'var(--ge-ink-3)',
        }}>
          {unit}
        </span>
      </div>

      {/* アクセントバー（左ボーダー） */}
      {alert && (
        <div style={{
          position: 'absolute', left: 0, top: 8, bottom: 8,
          width: 2, borderRadius: '0 2px 2px 0',
          background: 'var(--ge-danger)',
        }} />
      )}
    </div>
  )

  return href ? <Link href={href} style={{ textDecoration: 'none', display: 'block' }}>{content}</Link> : content
}

// ── メインコンポーネント ────────────────────────────────────────────────────────

export function TodaySummary({ currentVisitors, todayVisits, pendingBaggage, longStayCount, longStayVisitors }: Props) {
  return (
    <div style={{ marginBottom: 20 }}>
      {/* KPI カード行 */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 12,
        marginBottom: longStayVisitors.length > 0 ? 12 : 0,
      }}>
        <MetricCard
          icon={<IconPeople />}
          label="現在入室中"
          value={currentVisitors}
          unit="名"
        />
        <MetricCard
          icon={<IconClipboard />}
          label="本日の来訪"
          value={todayVisits}
          unit="件"
        />
        <MetricCard
          icon={<IconBaggage />}
          label="受付未監査"
          value={pendingBaggage}
          unit="件"
          href="/admin/visits"
          alert={pendingBaggage > 0}
        />
        <MetricCard
          icon={<IconClock />}
          label="長時間滞在"
          value={longStayCount}
          unit="名"
          alert={longStayCount > 0}
        />
      </div>

      {/* 長時間滞在 詳細リスト */}
      {longStayVisitors.length > 0 && (
        <div style={{
          background: 'var(--ge-warning-soft)',
          border: '1px solid #E8C98A',
          borderRadius: 6,
          padding: '10px 14px',
        }}>
          <p style={{
            font: '600 10px/1 var(--ge-font-latin)',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--ge-warning)',
            marginBottom: 8,
          }}>
            Long Stay · 詳細
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {longStayVisitors.map(v => (
              <div key={v.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                font: '400 12px/1 var(--ge-font-jp)',
                color: 'var(--ge-ink-2)',
              }}>
                <span style={{
                  fontFamily: 'var(--ge-font-mono)',
                  fontWeight: 600,
                  color: v.hours >= 8 ? 'var(--ge-danger)' : 'var(--ge-warning)',
                  minWidth: 40,
                }}>
                  {v.hours}h
                </span>
                <span style={{ fontWeight: 500 }}>{v.name}</span>
                <span style={{ color: 'var(--ge-ink-3)' }}>{v.company}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--ge-ink-4)' }}>{v.store}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
