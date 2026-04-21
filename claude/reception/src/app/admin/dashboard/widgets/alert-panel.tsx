'use client'

import Link from 'next/link'
import type { DashboardAlert } from '@/app/api/v1/admin/dashboard/stats/route'

const TYPE_LABELS: Record<string, string> = {
  inspection_rate_drop: '手荷物検査率低下',
  high_unmatch_rate:    'アンマッチ率上昇',
  pending_baggage:      '未審査手荷物あり',
  long_stay:            '長時間滞在検知',
  no_visits_today:      '本日来訪ゼロ',
}

const TYPE_LINKS: Record<string, string> = {
  inspection_rate_drop: '/admin/baggage',
  pending_baggage:      '/admin/baggage',
  long_stay:            '/admin/visits',
}

interface Props { alerts: DashboardAlert[] }

export function AlertPanel({ alerts }: Props) {
  if (alerts.length === 0) {
    return (
      <div style={{
        background: '#fff',
        border: '1px solid var(--ge-line)',
        borderRadius: 6,
        padding: '12px 16px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: 999,
          background: 'var(--ge-success)',
          flexShrink: 0,
        }} />
        <div>
          <p style={{ font: '600 13px/1 var(--ge-font-jp)', color: 'var(--ge-success)', margin: 0 }}>
            異常なし
          </p>
          <p style={{ font: '400 11px/1.4 var(--ge-font-jp)', color: 'var(--ge-ink-3)', margin: '4px 0 0' }}>
            現在、検知されたアラートはありません
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      background: '#fff',
      border: '1px solid var(--ge-line)',
      borderRadius: 6,
      marginBottom: 16,
      overflow: 'hidden',
    }}>
      {/* ヘッダー */}
      <div style={{
        padding: '10px 16px',
        borderBottom: '1px solid var(--ge-line)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        background: 'var(--ge-paper-2)',
      }}>
        <span style={{
          font: '600 10px/1 var(--ge-font-latin)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--ge-ink-3)',
          flex: 1,
        }}>
          Alerts
        </span>
        <span style={{
          fontFamily: 'var(--ge-font-mono)',
          fontSize: 11,
          color: 'var(--ge-danger)',
          background: 'var(--ge-danger-soft)',
          padding: '2px 7px',
          borderRadius: 2,
        }}>
          {alerts.length}件
        </span>
      </div>

      {/* アラートリスト */}
      <div>
        {alerts.map((alert, i) => {
          const href = TYPE_LINKS[alert.type]
          const isRed = alert.level === 'red'
          const row = (
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              padding: '10px 16px',
              borderBottom: i < alerts.length - 1 ? '1px solid var(--ge-line)' : 'none',
              cursor: href ? 'pointer' : 'default',
              transition: 'background 100ms',
            }}>
              {/* ステータスドット */}
              <span style={{
                width: 7, height: 7, borderRadius: 999, flexShrink: 0, marginTop: 4,
                background: isRed ? 'var(--ge-danger)' : 'var(--ge-warning)',
                boxShadow: isRed
                  ? '0 0 0 3px var(--ge-danger-soft)'
                  : '0 0 0 3px var(--ge-warning-soft)',
              }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {/* 種別ラベル */}
                  <span style={{
                    font: '600 11px/1 var(--ge-font-jp)',
                    color: isRed ? 'var(--ge-danger)' : 'var(--ge-warning)',
                  }}>
                    {TYPE_LABELS[alert.type] ?? alert.type}
                  </span>
                  {/* 店舗名タグ */}
                  {alert.store_name && (
                    <span style={{
                      font: '500 10px/1 var(--ge-font-jp)',
                      color: 'var(--ge-accent-ink)',
                      background: 'var(--ge-accent-soft)',
                      padding: '2px 7px',
                      borderRadius: 2,
                    }}>
                      {alert.store_name}
                    </span>
                  )}
                </div>
                <p style={{
                  font: '400 12px/1.4 var(--ge-font-jp)',
                  color: 'var(--ge-ink-3)',
                  margin: '4px 0 0',
                }}>
                  {alert.message}
                </p>
              </div>

              {href && (
                <span style={{
                  font: '400 11px/1 var(--ge-font-mono)',
                  color: 'var(--ge-ink-4)',
                  flexShrink: 0,
                  alignSelf: 'center',
                }}>
                  →
                </span>
              )}
            </div>
          )

          return href ? (
            <Link key={alert.id} href={href} style={{ textDecoration: 'none', display: 'block' }}>
              {row}
            </Link>
          ) : (
            <div key={alert.id}>{row}</div>
          )
        })}
      </div>
    </div>
  )
}
