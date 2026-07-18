'use client'

/**
 * 手荷物検査 詳細（T6・管理UI）
 *
 * 2カメラ同期再生（共有スクラバ1本・検査窓ハイライト）＋顔3枚比較
 * ＋「再生して確認」ボタン（再生開始後に活性化・D8）＋当日イベント時系列。
 * Genesis Edge トークン準拠。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { sessionBadge, type BadgeTone } from '@/lib/baggage/status'

type Clip = { cameraId: string | null; durationSec: number | null; clockOffsetSec: number | null; uploadStatus: string; url: string | null }
type EventRow = { id: string; kind: string; occurred_at: string; auth_skipped: boolean }
type Detail = {
  id: string; inspectionDate: string; personKind: string; visitorName: string | null; visitorCompany: string | null
  status: string; authSkipped: boolean; confirmedAt: string | null
  entryAt: string | null; exitAt: string | null
  employee: { name: string; employeeCode: string } | null
  faces: { entry: string | null; exit: string | null; card: string | null; master: string | null }
  events: EventRow[]; clips: Clip[]
}

const TONE: Record<BadgeTone, { bg: string; fg: string }> = {
  ok: { bg: '#E7F1EA', fg: 'var(--ge-success)' }, warn: { bg: '#F6EFE2', fg: 'var(--ge-warning)' },
  bad: { bg: '#F5E7E5', fg: 'var(--ge-danger)' }, muted: { bg: 'var(--ge-paper-3)', fg: 'var(--ge-ink-3)' },
  accent: { bg: 'var(--ge-accent-soft)', fg: 'var(--ge-accent)' },
}

export default function InspectionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pos, setPos] = useState(0)          // 0..1
  const [playedOnce, setPlayedOnce] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const videosRef = useRef<(HTMLVideoElement | null)[]>([])

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/v1/baggage/sessions/${id}`)
        if (!res.ok) { setError(res.status === 401 ? '認証が必要です' : '読み込みに失敗しました'); return }
        const json = await res.json(); setD(json.session); setConfirmed(!!json.session?.confirmedAt)
      } catch { setError('読み込みに失敗しました') }
    })()
  }, [id])

  const eachVideo = (fn: (v: HTMLVideoElement) => void) =>
    videosRef.current.forEach((v) => { if (v) fn(v) })

  const play = useCallback(() => { setPlayedOnce(true); eachVideo((v) => v.play().catch(() => {})) }, [])
  const pause = useCallback(() => eachVideo((v) => v.pause()), [])
  const seek = useCallback((ratio: number) => {
    setPos(ratio)
    eachVideo((v) => { if (v.duration) v.currentTime = ratio * v.duration })
  }, [])

  const confirm = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/baggage/sessions/${id}/confirm`, { method: 'POST' })
      if (res.ok) setConfirmed(true)
    } catch { /* noop */ }
  }, [id])

  if (error) return <Shell><p style={{ color: 'var(--ge-ink-3)' }}>{error}</p></Shell>
  if (!d) return <Shell><p style={{ color: 'var(--ge-ink-3)' }}>読み込み中…</p></Shell>

  const sb = sessionBadge(d.status)
  const person = d.employee?.name ?? d.visitorName ?? '（未特定）'

  return (
    <Shell>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>検査詳細</h1>
        <Badge label={sb.label} tone={sb.tone} />
        {d.authSkipped && <Badge label="認証省略" tone="muted" />}
        <span style={{ color: 'var(--ge-ink-3)', fontSize: 13 }}>{person}・{d.inspectionDate}</span>
      </div>

      {/* 2カメラ プレイヤー */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[0, 1].map((i) => {
          const clip = d.clips[i]
          return (
            <div key={i} style={{ background: '#0E1013', borderRadius: 6, aspectRatio: '16/9', overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6A90C8', fontSize: 13 }}>
              {clip?.url
                ? <video ref={(el) => { videosRef.current[i] = el }} src={clip.url} muted playsInline
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    onTimeUpdate={(e) => { if (i === 0 && e.currentTarget.duration) setPos(e.currentTarget.currentTime / e.currentTarget.duration) }} />
                : <span>カメラ{i + 1}: {clip ? '処理中' : '映像なし'}</span>}
            </div>
          )
        })}
      </div>

      {/* 共有スクラバ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, background: '#fff',
        border: '1px solid var(--ge-line)', borderRadius: 4, padding: '10px 16px' }}>
        <button onClick={play} style={miniBtn}>▶</button>
        <button onClick={pause} style={miniBtn}>❚❚</button>
        <input type="range" min={0} max={1} step={0.001} value={pos}
          onChange={(e) => seek(Number(e.target.value))} style={{ flex: 1 }} />
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, color: 'var(--ge-ink-3)' }}>2カメラ同期</span>
      </div>

      {/* 再生して確認（D8） */}
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={confirm} disabled={!playedOnce || confirmed}
          style={{ height: 44, padding: '0 20px', borderRadius: 4, fontFamily: 'inherit', fontSize: 14, fontWeight: 700,
            border: 'none', cursor: playedOnce && !confirmed ? 'pointer' : 'not-allowed',
            background: confirmed ? '#E7F1EA' : playedOnce ? 'var(--ge-accent)' : 'var(--ge-paper-3)',
            color: confirmed ? 'var(--ge-success)' : playedOnce ? '#fff' : 'var(--ge-ink-3)' }}>
          {confirmed ? '✓ 確認済み' : '再生して確認'}
        </button>
        {!playedOnce && !confirmed && <span style={{ fontSize: 12, color: 'var(--ge-ink-3)' }}>映像を再生すると確認できます</span>}
      </div>

      {/* 顔3枚 比較 */}
      <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
        <FaceCard label="入室" url={d.faces.entry} sub={hhmm(d.entryAt)} />
        <FaceCard label="退出" url={d.faces.exit} sub={hhmm(d.exitAt)} />
        <FaceCard label="登録（マスタ）" url={d.faces.master} sub={d.employee?.name ?? '—'} />
      </div>

      {/* 当日イベント時系列（D17） */}
      {d.events.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>当日の記録</h3>
          <ul style={{ listStyle: 'none', fontSize: 13, color: 'var(--ge-ink-2)' }}>
            {d.events.map((e) => (
              <li key={e.id} style={{ padding: '4px 0', borderBottom: '1px solid var(--ge-line)' }}>
                <span style={{ fontFamily: 'IBM Plex Mono, monospace', marginRight: 10 }}>{hhmm(e.occurred_at)}</span>
                {e.kind === 'temp_exit' ? '途中退室' : '途中入室'}{e.auth_skipped ? '（認証省略）' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p style={{ fontSize: 12, color: 'var(--ge-ink-3)', marginTop: 16 }}>この映像・顔写真の閲覧は監査ログに記録されます。</p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px' }}>{children}</div>
}
function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  const st = TONE[tone]
  return <span style={{ fontSize: 12, borderRadius: 4, padding: '2px 10px', background: st.bg, color: st.fg }}>{label}</span>
}
function FaceCard({ label, url, sub }: { label: string; url: string | null; sub: string }) {
  return (
    <div style={{ flex: 1, display: 'flex', gap: 12, alignItems: 'center', border: '1px solid var(--ge-line)',
      borderRadius: 6, padding: '10px 14px', background: '#fff' }}>
      <div style={{ width: 56, height: 56, borderRadius: 4, background: 'var(--ge-paper-3)', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: 'var(--ge-ink-3)' }}>
        {url ? <img src={url} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : label}
      </div>
      <div><div style={{ fontSize: 12, color: 'var(--ge-ink-3)' }}>{label}</div>
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 14 }}>{sub}</div></div>
    </div>
  )
}
function hhmm(iso: string | null) {
  return iso ? new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '—'
}
const miniBtn: React.CSSProperties = { width: 34, height: 34, borderRadius: '50%', border: '1px solid var(--ge-line-2)',
  background: '#fff', color: 'var(--ge-ink-2)', fontSize: 12, cursor: 'pointer' }
