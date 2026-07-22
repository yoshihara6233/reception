'use client'

/**
 * 検査詳細ペイン（master-detail 右側）。
 * 一覧で行を選ぶたびに /api/baggage/sessions/[id]/detail を取得して描画する。
 * 単独ページ /baggage/[id]（SCREEN H）と同じ構成（2カメラ再生＋顔比較列＋メタ）を
 * 右ペインに収める。閲覧記録・写真/クリップ署名URLは従来の API を素通しで再利用。
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SessionPlayer, type PlayerClip } from './[id]/SessionPlayer'
import { ConfirmButton } from './[id]/ConfirmButton'
import { sessionBadge, AUTH_SKIPPED_BADGE, type BadgeDef } from '@/lib/baggage/status'

interface Detail {
  id: string
  personKind: 'staff' | 'visitor'
  person: string
  visitorCompany: string | null
  entryAt: string | null
  exitAt: string | null
  hasEntryFace: boolean
  hasExitFace: boolean
  hasCardPhoto: boolean
  employeeName: string | null
  hasEmployeeFace: boolean
  inspectionStartedAt: string | null
  inspectionEndedAt: string | null
  status: string
  authSkipped: boolean
  confirmedAt: string | null
  inspectionDate: string
  consentAt: string | null
  consentVersion: number | null
  storeName: string | null
  windowSec: number | null
  maxOffset: number | null
  clips: PlayerClip[]
  /** 切り出しジョブ実行中（映像がこれから増える）。true の間は確認済みを解禁しない。 */
  clipsPending: boolean
}

const toneClass: Record<BadgeDef['tone'], string> = {
  ok:     'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  warn:   'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  bad:    'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  muted:  'bg-slate-200 text-slate-600 dark:bg-gedbg3 dark:text-gedink3',
  accent: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
}

const hms = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ja-JP', { hour12: false, timeZone: 'Asia/Tokyo' }) : '—'

function Face(
  { sessionId, kind, label, sub, has, onZoom }:
  { sessionId: string; kind: 'entry' | 'exit' | 'employee' | 'card'; label: string; sub: string; has: boolean; onZoom: (src: string, label: string) => void },
) {
  const src = `/api/baggage/sessions/${sessionId}/photo?kind=${kind}`
  return (
    <div className="flex flex-1 items-center gap-3 rounded border border-slate-200 bg-white p-3 dark:border-gedline dark:bg-gedbg2">
      <button
        type="button"
        disabled={!has}
        onClick={() => has && onZoom(src, label)}
        title={has ? 'クリックで拡大' : undefined}
        className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded bg-slate-200 text-[10px] text-slate-500 disabled:cursor-default dark:bg-gedbg3 dark:text-gedink3"
        style={{ cursor: has ? 'zoom-in' : 'default' }}
      >
        {has
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={src} alt={label} className="h-full w-full object-cover" />
          : 'なし'}
      </button>
      <div>
        <div className="text-[11px] text-slate-500 dark:text-gedink3">{label}</div>
        <div className="font-mono text-sm tabular-nums text-slate-800 dark:text-gedink">{sub}</div>
      </div>
    </div>
  )
}

export function SessionDetailPane({ sessionId }: { sessionId: string | null }) {
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 映像を最後まで再生した検査だけ「確認済み」を解禁（セッションIDで管理）。
  const [reviewedId, setReviewedId] = useState<string | null>(null)
  // 顔/名刺の拡大表示（ライトボックス）。
  const [zoom, setZoom] = useState<{ src: string; label: string } | null>(null)

  useEffect(() => {
    if (!sessionId) { setDetail(null); setError(null); return }
    let alive = true
    setLoading(true); setError(null)
    fetch(`/api/baggage/sessions/${sessionId}/detail`)
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 404 ? 'この検査は表示できません' : '詳細の取得に失敗しました')
        return res.json() as Promise<Detail>
      })
      .then((d) => { if (alive) setDetail(d) })
      .catch((e) => { if (alive) { setDetail(null); setError((e as Error).message) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [sessionId])

  if (!sessionId) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded border border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-gedline dark:bg-gedbg2 dark:text-gedink3">
        左の一覧から検査を選ぶと、ここに映像と顔比較が表示されます。
      </div>
    )
  }
  if (loading && !detail) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded border border-slate-200 bg-white p-6 text-sm text-slate-500 dark:border-gedline dark:bg-gedbg2 dark:text-gedink3">
        読み込み中…
      </div>
    )
  }
  if (error || !detail) {
    return (
      <div className="flex h-full min-h-[320px] items-center justify-center rounded border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
        {error ?? '詳細を取得できませんでした'}
      </div>
    )
  }

  const badge = sessionBadge(detail.status)
  const windowLabel = detail.windowSec !== null
    ? `検査窓 ${Math.floor(detail.windowSec / 60)}:${String(Math.round(detail.windowSec % 60)).padStart(2, '0')}（±15s バッファ含む）`
    : 'クリップ処理中（エッジ切り出し待ち）'

  return (
    <>
    <div className="space-y-4 rounded border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
      {/* 見出し行 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-[15px] font-medium text-slate-900 dark:text-gedink">{detail.person}</span>
        <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${toneClass[badge.tone]}`}>{badge.label}</span>
        {detail.authSkipped && (
          <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${toneClass[AUTH_SKIPPED_BADGE.tone]}`}>{AUTH_SKIPPED_BADGE.label}</span>
        )}
        <span className="font-mono text-[12px] text-slate-500 dark:text-gedink3">#{detail.id.slice(0, 8)}</span>
        <div className="ml-auto flex items-center gap-3">
          <ConfirmButton sessionId={detail.id} confirmed={detail.confirmedAt !== null} disabled={reviewedId !== detail.id} />
          <Link href={`/baggage/${detail.id}`} className="text-[12px] text-blue-700 hover:underline dark:text-gedaccent">別画面で開く ↗</Link>
        </div>
      </div>

      {/* 顔認証省略時: 入退室の同一人物性は未確認である旨（OV: 過信させない） */}
      {detail.authSkipped && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          顔認証が省略されたため、入室と退出が<strong>同一人物である保証はありません</strong>（滞在中の最新の入室記録に自動で対応づけています）。下の映像と顔写真でご確認ください。
        </div>
      )}

      {/* 2カメラ同期プレイヤー（倍速対応・シーク不可）。key で行切替のたびに再生状態を初期化 */}
      <SessionPlayer key={detail.id} clips={detail.clips} windowLabel={windowLabel} clipsPending={detail.clipsPending} onReviewed={() => setReviewedId(detail.id)} />

      {/* 顔比較列 */}
      <div className="flex flex-col gap-3 md:flex-row">
        <Face sessionId={detail.id} kind="entry" label={detail.authSkipped ? '入室（推定）' : '入室'} sub={hms(detail.entryAt)} has={detail.hasEntryFace} onZoom={(s, l) => setZoom({ src: s, label: l })} />
        <Face sessionId={detail.id} kind="exit" label={detail.authSkipped ? '退出（推定）' : '退出'} sub={hms(detail.exitAt)} has={detail.hasExitFace} onZoom={(s, l) => setZoom({ src: s, label: l })} />
        {detail.personKind === 'staff'
          ? <Face sessionId={detail.id} kind="employee" label="従業員マスタ" sub={detail.employeeName ?? '未登録'} has={detail.hasEmployeeFace} onZoom={(s, l) => setZoom({ src: s, label: l })} />
          : <Face sessionId={detail.id} kind="card" label="名刺" sub={detail.visitorCompany ?? detail.person} has={detail.hasCardPhoto} onZoom={(s, l) => setZoom({ src: s, label: l })} />}
      </div>

      {/* メタ */}
      <div className="flex flex-wrap gap-6 border-t border-slate-200 pt-3 text-[13px] text-slate-700 dark:border-gedline dark:text-gedink2">
        <div><div className="text-[11px] text-slate-500 dark:text-gedink3">店舗</div>{detail.storeName ?? '—'}</div>
        <div><div className="text-[11px] text-slate-500 dark:text-gedink3">区分</div>{detail.personKind === 'staff' ? '従業員' : '来訪者'}</div>
        <div><div className="text-[11px] text-slate-500 dark:text-gedink3">検査窓</div>
          <span className="font-mono tabular-nums">{hms(detail.inspectionStartedAt)} 〜 {hms(detail.inspectionEndedAt)}</span></div>
        <div><div className="text-[11px] text-slate-500 dark:text-gedink3">NVR時刻差</div>
          <span className="font-mono tabular-nums">{detail.maxOffset === null ? '—' : `${detail.maxOffset >= 0 ? '+' : ''}${detail.maxOffset}s`}</span></div>
        {detail.personKind === 'visitor' && (
          <div><div className="text-[11px] text-slate-500 dark:text-gedink3">個人情報同意</div>
            {detail.consentAt
              ? <span className="text-emerald-700 dark:text-emerald-400">同意 v{detail.consentVersion ?? 1}（{hms(detail.consentAt)}）</span>
              : <span className="text-slate-500 dark:text-gedink3">記録なし</span>}
          </div>
        )}
        <div className="ml-auto self-end text-slate-500 dark:text-gedink3">この閲覧は監査ログに記録されます</div>
      </div>
    </div>

    {/* 拡大表示（ライトボックス）。背景クリックで閉じる。 */}
    {zoom && (
      <div
        onClick={() => setZoom(null)}
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-6"
        role="dialog" aria-label={`${zoom.label} 拡大`}
      >
        <div className="text-[13px] text-white/80">{zoom.label}（クリックで閉じる）</div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={zoom.src} alt={zoom.label} className="max-h-[85vh] max-w-[92vw] rounded object-contain shadow-2xl" />
      </div>
    )}
    </>
  )
}
