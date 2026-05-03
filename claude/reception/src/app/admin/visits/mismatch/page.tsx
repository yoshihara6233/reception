'use client'

/**
 * /admin/visits/mismatch
 *
 * 入退室アンマッチ一覧
 *  - 未退室  : check_in_at が指定日 かつ 退室記録なし (status = checked_in | auto_closed)
 *  - 退室のみ : 入室記録なしで退室 (purpose = '__checkout_only__')
 */

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { VisitsNavBar } from '@/app/admin/_components/VisitsNavBar'

interface MismatchVisit {
  id: string
  visitor_id: string
  purpose: string
  status: string
  check_in_at: string
  check_out_at: string | null
  visitors: { company: string; name: string; department?: string } | null
  stores: { id: string; name: string } | null
}

interface MismatchData {
  date: string
  unmatched_checkin: MismatchVisit[]
  checkout_only: MismatchVisit[]
}

// 昨日の日付 (YYYY-MM-DD)
function yesterday() {
  return new Date(Date.now() - 86400_000).toISOString().slice(0, 10)
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ja-JP', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  })
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    checked_in:  { bg: '#dcfce7', color: '#15803d', label: '入室中' },
    auto_closed: { bg: '#fef9c3', color: '#a16207', label: '自動退室' },
    checked_out: { bg: '#f1f5f9', color: '#475569', label: '退室済' },
  }
  const s = map[status] ?? { bg: '#f1f5f9', color: '#475569', label: status }
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 999,
      font: '500 11px/1.4 var(--font-sans)',
      background: s.bg, color: s.color, whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  )
}

function MismatchTable({
  visits,
  type,
}: {
  visits: MismatchVisit[]
  type: 'unmatched_checkin' | 'checkout_only'
}) {
  if (visits.length === 0) {
    return (
      <div style={{
        padding: '24px', textAlign: 'center',
        color: 'var(--ge-ink-4)', font: '400 13px/1 var(--font-sans)',
        background: '#f8fafc', borderRadius: 8, border: '1px solid var(--ge-line)',
      }}>
        アンマッチなし ✓
      </div>
    )
  }

  return (
    <div style={{ background: '#fff', borderRadius: 8, border: '1px solid var(--ge-line)', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: 'var(--ge-paper)', borderBottom: '1px solid var(--ge-line)' }}>
            <th style={{ padding: '8px 12px', textAlign: 'left', font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', whiteSpace: 'nowrap' }}>訪問者</th>
            <th style={{ padding: '8px 12px', textAlign: 'left', font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', whiteSpace: 'nowrap' }}>会社</th>
            <th style={{ padding: '8px 12px', textAlign: 'left', font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', whiteSpace: 'nowrap' }}>店舗</th>
            {type === 'unmatched_checkin' ? (
              <>
                <th style={{ padding: '8px 12px', textAlign: 'left', font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', whiteSpace: 'nowrap' }}>入室時刻</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', whiteSpace: 'nowrap' }}>ステータス</th>
              </>
            ) : (
              <th style={{ padding: '8px 12px', textAlign: 'left', font: '500 11px/1 var(--font-sans)', color: 'var(--ge-ink-4)', whiteSpace: 'nowrap' }}>退室時刻</th>
            )}
            <th style={{ width: 80 }} />
          </tr>
        </thead>
        <tbody>
          {visits.map(v => (
            <tr key={v.id} style={{ borderBottom: '1px solid var(--ge-paper-2)' }}>
              <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                <Link
                  href={`/admin/visits/${v.id}`}
                  style={{ font: '500 12px/1.3 var(--font-sans)', color: 'var(--ge-accent)', textDecoration: 'none' }}
                >
                  {v.visitors?.name ?? '—'}
                </Link>
              </td>
              <td style={{ padding: '10px 12px', color: 'var(--ge-ink-2)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {v.visitors?.company ?? '—'}
              </td>
              <td style={{ padding: '10px 12px', color: 'var(--ge-ink-3)', whiteSpace: 'nowrap' }}>
                {v.stores?.name ?? '—'}
              </td>
              {type === 'unmatched_checkin' ? (
                <>
                  <td style={{ padding: '10px 12px', color: 'var(--ge-ink-3)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtDate(v.check_in_at)}
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <StatusBadge status={v.status} />
                  </td>
                </>
              ) : (
                <td style={{ padding: '10px 12px', color: 'var(--ge-ink-3)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtDate(v.check_out_at)}
                </td>
              )}
              <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                <Link
                  href={`/admin/visits/${v.id}`}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 8px', borderRadius: 4,
                    font: '500 11px/1 var(--font-sans)',
                    color: 'var(--ge-accent)', background: 'var(--ge-accent-soft)',
                    border: '1px solid var(--ge-accent-line)', textDecoration: 'none',
                  }}
                >
                  詳細 →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function MismatchPage() {
  const [date, setDate] = useState(yesterday())
  const [data, setData] = useState<MismatchData | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (d: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/v1/admin/mismatch?date=${d}`)
      if (res.ok) setData(await res.json())
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { load(date) }, [date, load])

  const totalMismatch = (data?.unmatched_checkin.length ?? 0) + (data?.checkout_only.length ?? 0)

  return (
    <div>
      {/* ── ナビゲーション ───────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <VisitsNavBar />
      </div>

      {/* ── ヘッダー ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ font: '700 24px/1.2 var(--font-sans)', color: '#1e3a5f', margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
            入退室アンマッチ
            {!loading && data && totalMismatch > 0 && (
              <span style={{
                padding: '2px 10px', borderRadius: 999,
                font: '600 13px/1.6 var(--font-sans)',
                background: '#fef2f2', color: '#b91c1c',
                border: '1px solid #fecaca',
              }}>
                {totalMismatch} 件
              </span>
            )}
            {!loading && data && totalMismatch === 0 && (
              <span style={{
                padding: '2px 10px', borderRadius: 999,
                font: '500 12px/1.6 var(--font-sans)',
                background: '#f0fdf4', color: '#15803d',
                border: '1px solid #bbf7d0',
              }}>
                ✓ 異常なし
              </span>
            )}
          </h1>
          <p style={{ font: '400 12px/1.4 var(--font-sans)', color: 'var(--ge-ink-4)', marginTop: 4 }}>
            入室のみ・退室のみの記録を1日単位でチェックします
          </p>
        </div>

        {/* 日付選択 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => {
              const d = new Date(date)
              d.setDate(d.getDate() - 1)
              setDate(d.toISOString().slice(0, 10))
            }}
            style={{
              width: 28, height: 28, borderRadius: 4, cursor: 'pointer',
              font: '400 14px/1 var(--font-sans)', color: 'var(--ge-ink-3)',
              background: '#fff', border: '1px solid var(--ge-line)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >‹</button>
          <input
            type="date"
            value={date}
            max={new Date().toISOString().slice(0, 10)}
            onChange={e => setDate(e.target.value)}
            style={{
              padding: '5px 10px', borderRadius: 4,
              font: '500 13px/1 var(--font-sans)', color: 'var(--ge-ink)',
              background: '#fff', border: '1px solid var(--ge-line)', outline: 'none',
            }}
          />
          <button
            onClick={() => {
              const d = new Date(date)
              d.setDate(d.getDate() + 1)
              const next = d.toISOString().slice(0, 10)
              if (next <= new Date().toISOString().slice(0, 10)) setDate(next)
            }}
            style={{
              width: 28, height: 28, borderRadius: 4, cursor: 'pointer',
              font: '400 14px/1 var(--font-sans)', color: 'var(--ge-ink-3)',
              background: '#fff', border: '1px solid var(--ge-line)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >›</button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--ge-ink-4)', font: '400 13px/1 var(--font-sans)' }}>
          <div style={{ display: 'inline-block', width: 20, height: 20, border: '2px solid var(--ge-line)', borderTop: '2px solid var(--ge-accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginRight: 8 }} />
          読み込み中...
        </div>
      ) : !data ? null : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

          {/* ── 未退室セクション ─────────────────────────────────────── */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: data.unmatched_checkin.length > 0 ? '#ef4444' : '#22c55e',
              }} />
              <h2 style={{ font: '600 15px/1 var(--font-sans)', color: 'var(--ge-ink)', margin: 0 }}>
                未退室
              </h2>
              <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--ge-ink-4)' }}>
                — 入室記録はあるが退室記録がない
              </span>
              <span style={{
                marginLeft: 'auto',
                padding: '1px 8px', borderRadius: 999,
                font: '600 11px/1.6 var(--font-sans)',
                background: data.unmatched_checkin.length > 0 ? '#fef2f2' : '#f0fdf4',
                color: data.unmatched_checkin.length > 0 ? '#b91c1c' : '#15803d',
                border: `1px solid ${data.unmatched_checkin.length > 0 ? '#fecaca' : '#bbf7d0'}`,
              }}>
                {data.unmatched_checkin.length} 件
              </span>
            </div>
            <MismatchTable visits={data.unmatched_checkin} type="unmatched_checkin" />
          </section>

          {/* ── 退室のみセクション ───────────────────────────────────── */}
          <section>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%',
                background: data.checkout_only.length > 0 ? '#f97316' : '#22c55e',
              }} />
              <h2 style={{ font: '600 15px/1 var(--font-sans)', color: 'var(--ge-ink)', margin: 0 }}>
                退室のみ
              </h2>
              <span style={{ font: '400 12px/1 var(--font-sans)', color: 'var(--ge-ink-4)' }}>
                — 退室記録はあるが入室記録がない
              </span>
              <span style={{
                marginLeft: 'auto',
                padding: '1px 8px', borderRadius: 999,
                font: '600 11px/1.6 var(--font-sans)',
                background: data.checkout_only.length > 0 ? '#fff7ed' : '#f0fdf4',
                color: data.checkout_only.length > 0 ? '#c2410c' : '#15803d',
                border: `1px solid ${data.checkout_only.length > 0 ? '#fed7aa' : '#bbf7d0'}`,
              }}>
                {data.checkout_only.length} 件
              </span>
            </div>
            <MismatchTable visits={data.checkout_only} type="checkout_only" />
          </section>

          {/* ── 説明フッター ─────────────────────────────────────────── */}
          <div style={{
            padding: '14px 16px',
            background: 'var(--ge-paper)',
            border: '1px solid var(--ge-line)',
            borderRadius: 8,
            font: '400 11px/1.6 var(--font-sans)',
            color: 'var(--ge-ink-4)',
          }}>
            <strong style={{ color: 'var(--ge-ink-3)' }}>アンマッチの原因として考えられること:</strong>
            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
              <li>未退室 — 退室時にQRコードをスキャンしなかった / 自動退室（24h閾値）で処理された</li>
              <li>退室のみ — 入室時にQRコードをスキャンしなかった / 別エリアで入室して当エリアから退室した</li>
            </ul>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
