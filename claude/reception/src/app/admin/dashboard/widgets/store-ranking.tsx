'use client'

import type { StoreRankItem } from '@/app/api/v1/admin/dashboard/stats/route'
import { useSiteConfig } from '@/lib/site-config'

function maxOf(items: StoreRankItem[]) {
  return Math.max(...items.map(i => i.value), 1)
}

interface RankingCardProps {
  title: string
  subtitle: string
  items: StoreRankItem[]
  valueFormatter: (v: number, item: StoreRankItem) => string
  deltaFormatter?: (d: number) => string
  barColor: string
  goalLine?: number
  lowerIsBetter?: boolean
}

function RankingCard({
  title, subtitle, items, valueFormatter, deltaFormatter, barColor, goalLine, lowerIsBetter,
}: RankingCardProps) {
  const maxVal = maxOf(items)

  return (
    <div style={{
      background: '#fff',
      border: '1px solid var(--ge-line)',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {/* カードヘッダー */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--ge-line)',
        background: 'var(--ge-paper-2)',
      }}>
        <h3 style={{
          font: '600 12px/1 var(--ge-font-jp)',
          color: 'var(--ge-ink)',
          margin: 0,
        }}>
          {title}
        </h3>
        <p style={{
          font: '400 10px/1.3 var(--ge-font-jp)',
          color: 'var(--ge-ink-3)',
          margin: '4px 0 0',
        }}>
          {subtitle}
        </p>
      </div>

      <div style={{ padding: '12px 14px' }}>
        {items.length === 0 ? (
          <p style={{
            font: '400 12px/1 var(--ge-font-jp)',
            color: 'var(--ge-ink-4)',
            textAlign: 'center',
            padding: '16px 0',
          }}>
            データなし
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((item, idx) => {
              const delta  = item.delta_pct
              const bad    = lowerIsBetter ? (delta ?? 0) > 5 : (delta ?? 0) < -5
              const good   = lowerIsBetter ? (delta ?? 0) < -5 : (delta ?? 0) > 5
              const barPct = Math.round((item.value / maxVal) * 100)
              const atGoal = goalLine !== undefined && item.value < goalLine

              return (
                <div key={item.store_id}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    {/* 順位番号 */}
                    <span style={{
                      fontFamily: 'var(--ge-font-mono)',
                      fontSize: 10,
                      fontWeight: 600,
                      color: idx === 0 ? 'var(--ge-accent)' : 'var(--ge-ink-4)',
                      width: 16,
                      flexShrink: 0,
                      textAlign: 'right',
                    }}>
                      {idx + 1}
                    </span>

                    {/* 店舗名 */}
                    <span style={{
                      font: '500 12px/1 var(--ge-font-jp)',
                      color: 'var(--ge-ink)',
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {item.store_name}
                    </span>

                    {/* 数値 */}
                    <span style={{
                      fontFamily: 'var(--ge-font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                      fontSize: 12,
                      fontWeight: 600,
                      color: atGoal ? 'var(--ge-danger)' : 'var(--ge-ink)',
                      flexShrink: 0,
                    }}>
                      {valueFormatter(item.value, item)}
                    </span>

                    {/* 前期比 */}
                    {delta !== undefined && deltaFormatter && (
                      <span style={{
                        fontFamily: 'var(--ge-font-mono)',
                        fontSize: 10,
                        fontVariantNumeric: 'tabular-nums',
                        color: bad ? 'var(--ge-danger)' : good ? 'var(--ge-success)' : 'var(--ge-ink-4)',
                        width: 40,
                        textAlign: 'right',
                        flexShrink: 0,
                      }}>
                        {deltaFormatter(delta)}
                      </span>
                    )}
                  </div>

                  {/* バー */}
                  <div style={{
                    marginLeft: 24,
                    height: 3,
                    background: 'var(--ge-paper-2)',
                    borderRadius: 2,
                    overflow: 'hidden',
                    position: 'relative',
                  }}>
                    <div style={{
                      position: 'absolute', left: 0, top: 0, height: '100%',
                      width: `${barPct}%`,
                      background: atGoal ? 'var(--ge-danger)' : barColor,
                      borderRadius: 2,
                      transition: 'width 400ms var(--ge-ease-out)',
                    }} />
                    {goalLine !== undefined && goalLine <= 100 && (
                      <div style={{
                        position: 'absolute', top: 0, bottom: 0, left: `${goalLine}%`,
                        width: 1, background: 'var(--ge-accent-line)',
                      }} />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 目標ライン凡例 */}
        {goalLine !== undefined && (
          <p style={{
            font: '400 10px/1 var(--ge-font-latin)',
            color: 'var(--ge-ink-4)',
            marginTop: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}>
            <span style={{ display: 'inline-block', width: 12, height: 1, background: 'var(--ge-accent-line)', verticalAlign: 'middle' }} />
            目標 {goalLine}%
          </p>
        )}
      </div>
    </div>
  )
}

// ── 期間切替ボタン ─────────────────────────────────────────────────────────────

interface Props {
  period: string
  onPeriodChange: (p: string) => void
  rankings: {
    visits: StoreRankItem[]
    inspection_rate: StoreRankItem[]
    pending_baggage: StoreRankItem[]
    unmatch_rate: StoreRankItem[]
  }
  visibleWidgets: {
    store_ranking_visits: boolean
    store_ranking_inspection_rate: boolean
    store_ranking_pending: boolean
    store_ranking_unmatch: boolean
  }
}

const PERIODS = [
  { value: 'today', label: '今日' },
  { value: 'week',  label: '今週' },
  { value: 'month', label: '今月' },
]

function deltaPctLabel(d: number): string {
  if (d === 0) return '±0'
  return d > 0 ? `+${d}%` : `${d}%`
}
function deltaPtLabel(d: number): string {
  if (d === 0) return '±0pt'
  return d > 0 ? `+${d}pt` : `${d}pt`
}

export function StoreRanking({ period, onPeriodChange, rankings, visibleWidgets }: Props) {
  const { locationName } = useSiteConfig()
  const hasAny = visibleWidgets.store_ranking_visits || visibleWidgets.store_ranking_inspection_rate
    || visibleWidgets.store_ranking_pending || visibleWidgets.store_ranking_unmatch
  if (!hasAny) return null

  return (
    <div style={{ marginBottom: 20 }}>
      {/* ヘッダー + 期間切替 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{
          font: '600 10px/1 var(--ge-font-latin)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: 'var(--ge-ink-3)',
        }}>
          {locationName}別ランキング
        </span>

        {/* 期間セグメント */}
        <div style={{
          display: 'flex',
          border: '1px solid var(--ge-line)',
          borderRadius: 4,
          overflow: 'hidden',
        }}>
          {PERIODS.map(p => (
            <button
              key={p.value}
              onClick={() => onPeriodChange(p.value)}
              style={{
                padding: '5px 10px',
                font: '500 11px/1 var(--ge-font-jp)',
                color: period === p.value ? '#fff' : 'var(--ge-ink-3)',
                background: period === p.value ? 'var(--ge-accent)' : '#fff',
                border: 'none',
                borderRight: p.value !== 'month' ? '1px solid var(--ge-line)' : 'none',
                cursor: 'pointer',
                transition: 'background 100ms, color 100ms',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {visibleWidgets.store_ranking_visits && (
          <RankingCard
            title="来客数ランキング"
            subtitle={`期間内の${locationName}別来訪件数`}
            items={rankings.visits}
            valueFormatter={v => `${v.toLocaleString()}件`}
            deltaFormatter={deltaPctLabel}
            barColor="var(--ge-accent)"
          />
        )}
        {visibleWidgets.store_ranking_inspection_rate && (
          <RankingCard
            title="手荷物検査実施率"
            subtitle="来訪数に対する手荷物申告ありの割合"
            items={rankings.inspection_rate}
            valueFormatter={v => `${v}%`}
            deltaFormatter={deltaPtLabel}
            barColor="var(--ge-success)"
            goalLine={80}
          />
        )}
        {visibleWidgets.store_ranking_pending && (
          <RankingCard
            title="受付未監査"
            subtitle="未審査・フラグの積み残し件数（少ないほど良い）"
            items={rankings.pending_baggage}
            valueFormatter={v => `${v}件`}
            barColor="var(--ge-danger)"
            lowerIsBetter
          />
        )}
        {visibleWidgets.store_ranking_unmatch && (
          <RankingCard
            title="アンマッチ率"
            subtitle="退室なし（自動クローズ）の割合（低いほど良い）"
            items={rankings.unmatch_rate}
            valueFormatter={(v, item) => `${v}%（${item.total ?? 0}件中）`}
            deltaFormatter={deltaPtLabel}
            barColor="var(--ge-warning)"
            lowerIsBetter
          />
        )}
      </div>
    </div>
  )
}
