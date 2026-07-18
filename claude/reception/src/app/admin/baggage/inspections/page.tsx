'use client'

/**
 * 手荷物検査 履歴一覧（T6・管理UI）
 *
 * 状態バッジ先頭列・フィルタチップ（状態絞り込み＝P6）・未確認フィルタ（D8）。
 * Genesis Edge トークン（--ge-*）準拠。空状態はセットアップ誘導。
 */
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  sessionBadge, clipBadge, HISTORY_FILTERS, AUTH_SKIPPED_BADGE, UNCONFIRMED_BADGE,
  type HistoryFilterKey, type BadgeTone,
} from '@/lib/baggage/status'

type Row = {
  id: string
  inspection_date: string
  person_kind: 'staff' | 'visitor'
  visitor_name: string | null
  entry_at: string | null
  exit_at: string | null
  status: string
  auth_skipped: boolean
  confirmed_at: string | null
  store_employees: { name: string } | null
  inspection_clips: { upload_status: string }[]
}

const TONE_STYLE: Record<BadgeTone, { bg: string; fg: string }> = {
  ok:     { bg: '#E7F1EA', fg: 'var(--ge-success)' },
  warn:   { bg: '#F6EFE2', fg: 'var(--ge-warning)' },
  bad:    { bg: '#F5E7E5', fg: 'var(--ge-danger)' },
  muted:  { bg: 'var(--ge-paper-3)', fg: 'var(--ge-ink-3)' },
  accent: { bg: 'var(--ge-accent-soft)', fg: 'var(--ge-accent)' },
}

function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  const st = TONE_STYLE[tone]
  return (
    <span style={{ fontSize: 12, borderRadius: 4, padding: '2px 10px', whiteSpace: 'nowrap',
      background: st.bg, color: st.fg, marginRight: 4 }}>{label}</span>
  )
}

function hhmm(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '—'
}

export default function InspectionsPage() {
  const [filter, setFilter] = useState<HistoryFilterKey>('all')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (f: HistoryFilterKey) => {
    setRows(null); setError(null)
    try {
      const res = await fetch(`/api/v1/baggage/sessions?filter=${f}`)
      if (!res.ok) { setError(res.status === 401 ? '認証が必要です' : '読み込みに失敗しました'); setRows([]); return }
      const json = await res.json()
      setRows(json.sessions ?? [])
    } catch {
      setError('読み込みに失敗しました'); setRows([])
    }
  }, [])

  useEffect(() => { load(filter) }, [filter, load])

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 20px' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 14, color: 'var(--ge-ink)' }}>手荷物検査 履歴</h1>

      {/* フィルタチップ */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {HISTORY_FILTERS.map((f) => {
          const on = filter === f.key
          return (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              fontSize: 13, border: `1px solid ${on ? 'var(--ge-accent)' : 'var(--ge-line)'}`,
              borderRadius: 4, padding: '4px 12px', cursor: 'pointer',
              background: on ? 'var(--ge-accent-soft)' : '#fff', color: on ? 'var(--ge-accent)' : 'var(--ge-ink-2)',
              fontWeight: on ? 500 : 400, fontFamily: 'inherit',
            }}>{f.label}</button>
          )
        })}
      </div>

      {rows === null && <p style={{ color: 'var(--ge-ink-3)' }}>読み込み中…</p>}

      {rows && rows.length === 0 && (
        <div style={{ border: '1px dashed var(--ge-line-2)', borderRadius: 8, padding: '40px 24px',
          textAlign: 'center', color: 'var(--ge-ink-3)', background: '#fff' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ge-ink-2)', marginBottom: 6 }}>
            {error ?? '検査履歴はまだありません'}
          </div>
          {!error && <p style={{ fontSize: 13 }}>iPad で入室・退室が記録されると、ここに一覧表示されます。<br />
            設定でオプションを有効化し、カメラ2台と従業員マスタを登録してください。</p>}
          {!error && <Link href="/admin/baggage/settings" style={{ color: 'var(--ge-accent)', fontSize: 13 }}>
            → 設定を開く</Link>}
        </div>
      )}

      {rows && rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, background: '#fff' }}>
          <thead>
            <tr>
              {['状態', '日付', '時刻', '人物', '区分', '映像', ''].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--ge-line-2)',
                  fontSize: 12, color: 'var(--ge-ink-3)', fontWeight: 700 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sb = sessionBadge(r.status)
              const cb = clipBadge((r.inspection_clips ?? []).map((c) => c.upload_status))
              return (
                <tr key={r.id}>
                  <td style={td}>
                    <Badge label={sb.label} tone={sb.tone} />
                    {r.auth_skipped && <Badge label={AUTH_SKIPPED_BADGE.label} tone={AUTH_SKIPPED_BADGE.tone} />}
                    {!r.confirmed_at && <Badge label={UNCONFIRMED_BADGE.label} tone={UNCONFIRMED_BADGE.tone} />}
                  </td>
                  <td style={{ ...td, fontFamily: 'IBM Plex Mono, monospace' }}>{r.inspection_date}</td>
                  <td style={{ ...td, fontFamily: 'IBM Plex Mono, monospace' }}>{hhmm(r.exit_at ?? r.entry_at)}</td>
                  <td style={td}>{r.store_employees?.name ?? r.visitor_name ?? '（未特定）'}</td>
                  <td style={td}>{r.person_kind === 'staff' ? '従業員' : '来訪者'}</td>
                  <td style={td}><Badge label={cb.label} tone={cb.tone} /></td>
                  <td style={td}>
                    <Link href={`/admin/baggage/inspections/${r.id}`} style={{ color: 'var(--ge-accent)' }}>詳細</Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

const td: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid var(--ge-line)', verticalAlign: 'top' }
