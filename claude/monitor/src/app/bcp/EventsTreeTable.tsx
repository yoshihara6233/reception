'use client'

/**
 * F37: BCP イベントタブのツリー表示。
 *
 * bcp_events テーブルは「アラート × 店舗」の組合せ単位で 1 行を持つ。
 * 同一の Jアラート発令から派生した複数行を (alert_type + alert_issued_at +
 * area_code) でグルーピングし、親行 = アラート / 子行 = 対象店舗 という
 * ツリー表示にする。▶ をクリックすると同行が展開される。
 */
import { useMemo, useState } from 'react'
import { prefName } from '@/lib/jp-prefectures'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLang } from '@/lib/i18n/context'
import type { Msg } from '@/lib/i18n/messages'
import { intensityRank, jmaIntensityLabel } from '@/lib/bcp/intensity'
import { FileText } from 'lucide-react'

export interface BcpEventChild {
  id:               string
  status:           string
  is_test:          boolean
  alert_issued_at:  string
  alert_type:       string
  area_code:        string | null
  max_intensity:    string | null
  /** JMA の地震識別子。同一地震の全電文で共通。2026-08-09 以前の行は null。 */
  jma_event_id:     string | null
  store_id:         string | null
  store_name:       string | null
}

/** F42: per-event PDF report info, fed by /bcp/page.tsx */
export interface BcpReportLite {
  event_id:       string
  pdf_url:        string | null
  sent_to_emails: string[] | null
}

const STATUS_STYLE: Record<string, string> = {
  pending:          'bg-yellow-100 text-yellow-700',
  recording:        'bg-orange-100 text-orange-700',
  clips_uploaded:   'bg-blue-100 text-blue-700',
  report_generated: 'bg-blue-100 text-blue-700',
  completed:        'bg-emerald-100 text-emerald-700',
  failed:           'bg-red-100 text-red-700',
  // F37: aggregated parent-row statuses
  in_progress:      'bg-orange-100 text-orange-700',
  partial:          'bg-amber-100 text-amber-700',
}

function statusLabel(s: string, b: Msg['bcpDashboard']): string {
  switch (s) {
    case 'pending':          return b.statusPending
    case 'recording':        return b.statusRecording
    case 'clips_uploaded':   return b.statusClipsUploaded
    case 'report_generated': return b.statusReportGenerated
    case 'completed':        return b.statusCompleted
    case 'failed':           return b.statusFailed
    case 'in_progress':      return b.statusInProgress
    case 'partial':          return b.statusPartial
    default:                 return s
  }
}

function alertTypeLabel(t: string, b: Msg['bcpDashboard']): string {
  switch (t) {
    case 'tsunami':    return b.alertTypeTsunami
    case 'earthquake': return b.alertTypeEarthquake
    case 'missile':    return b.alertTypeMissile
    case 'test':       return b.alertTypeTest
    default:           return t
  }
}

function fmtJST(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

interface AlertGroup {
  key:               string
  alert_type:        string
  alert_issued_at:   string
  area_code:         string | null
  max_intensity:     string | null
  is_test:           boolean
  stores:            BcpEventChild[]
  aggregated_status: string
}

/**
 * グループキー。
 *
 * 1 つの地震に対し気象庁は複数の電文を出す（震度速報 → 震源に関する情報 →
 * 震源・震度情報 → 続報）。電文ごとに alert_issued_at が違うため、従来の
 * `alert_type|alert_issued_at|area_code` では**同じ地震が 2 行以上に割れて**いた
 * （2026-08-01 02:49 に 18 店舗・02:52 に 24 店舗＝実際は 1 回の地震）。
 * JMA の EventID は同一地震の全電文で共通なので、あればそれを鍵にする。
 * 2026-08-09 以前の行と JMA 以外の発令は null なので従来キーへフォールバックする。
 */
function groupKeyOf(r: BcpEventChild): string {
  return r.jma_event_id
    ? `jma:${r.alert_type}|${r.jma_event_id}`
    : `${r.alert_type}|${r.alert_issued_at}|${r.area_code ?? ''}`
}

function groupByAlert(rows: BcpEventChild[]): AlertGroup[] {
  const map = new Map<string, AlertGroup>()
  for (const r of rows) {
    const key = groupKeyOf(r)
    let g = map.get(key)
    if (!g) {
      g = {
        key,
        alert_type:        r.alert_type,
        alert_issued_at:   r.alert_issued_at,
        area_code:         r.area_code,
        max_intensity:     r.max_intensity,
        is_test:           r.is_test,
        stores:            [],
        aggregated_status: 'completed',
      }
      map.set(key, g)
    }
    // max_intensity は店舗ごとの観測震度（同一発令でも県によって異なる）。
    // 親行にはその発令で最も強かった震度を出す。古い行は震度が無いことがある（バックフィル前）。
    if (intensityRank(r.max_intensity) > intensityRank(g.max_intensity)) {
      g.max_intensity = r.max_intensity
    }
    // EventID でまとめると 1 グループに複数の電文（震度速報／震源震度情報）が入る。
    // 親行の日時は「最初に検知した時刻」＝最も早い alert_issued_at を出す。
    if (r.alert_issued_at < g.alert_issued_at) g.alert_issued_at = r.alert_issued_at
    g.stores.push(r)
  }
  // Compute aggregated status: failed > in_progress > partial > completed
  for (const g of map.values()) {
    const statuses = g.stores.map((s) => s.status)
    const anyFailed = statuses.some((s) => s === 'failed')
    const anyActive = statuses.some((s) => s === 'pending' || s === 'recording')
    const allDone   = statuses.every((s) => s === 'completed' || s === 'report_generated' || s === 'clips_uploaded')
    g.aggregated_status =
      anyFailed   ? 'failed' :
      anyActive   ? 'in_progress' :
      allDone     ? 'completed' :
                    'partial'
  }
  // Sort: newest issued_at first
  return [...map.values()].sort((a, b) =>
    b.alert_issued_at.localeCompare(a.alert_issued_at),
  )
}

// F40.2: defensive lookup helper — protects against stale MESSAGES objects
// served by HMR after we added new i18n keys in F37/F40.
function dStr(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

// F40.4: format "N stores / N 店舗" without going through a function-valued
// message (`tBcp.storeCountValue`). Function values in MESSAGES turned out to
// be fragile under Turbopack HMR — every time messages.ts changed, the running
// EventsTreeTable bundle could end up with an OLD MESSAGES where the function
// was missing, throwing "is not a function". Pure string formatting based on
// `lang` is immune. Keep this in sync with messages.ts → bcpDashboard if
// translators tweak the format.
function fmtStoreCount(lang: string, n: number): string {
  switch (lang) {
    case 'en': return `${n} ${n === 1 ? 'store' : 'stores'}`
    case 'zh': return `${n} 门店`
    case 'ko': return `${n} 매장`
    default:   return `${n} 店舗`
  }
}

export function EventsTreeTable({
  rows,
  reports = [],
}: {
  rows:    BcpEventChild[]
  /** F42: per-event PDF reports. Mapped to child rows by event_id. */
  reports?: BcpReportLite[]
}) {
  const reportByEventId = useMemo(() => {
    const m = new Map<string, BcpReportLite>()
    for (const r of reports) m.set(r.event_id, r)
    return m
  }, [reports])
  const { lang, t } = useLang()
  const tBcpRaw = (t.bcpDashboard ?? {}) as Partial<Msg['bcpDashboard']>
  // Build a fully-typed tBcp with fallbacks for every recently-added STRING key.
  // Old keys (statusOpen / colStore / emptyEventsTitle …) were present from
  // the start so they don't need protection; F37 / F40 additions do.
  // F40.4: storeCountValue (a function-valued key) was REMOVED from this
  // patched object — we now format via fmtStoreCount(lang, n) instead, which
  // can't suffer from "is not a function" because no function ref is dereffed.
  const tBcp: Msg['bcpDashboard'] = {
    ...(tBcpRaw as Msg['bcpDashboard']),
    colStoreCount:    dStr(tBcpRaw.colStoreCount,    '対象店舗'),
    statusPartial:    dStr(tBcpRaw.statusPartial,    '一部完了'),
    expandAria:       dStr(tBcpRaw.expandAria,       '展開'),
    collapseAria:     dStr(tBcpRaw.collapseAria,     '折りたたみ'),
  }
  const groups = useMemo(() => groupByAlert(rows), [rows])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else                next.add(key)
      return next
    })
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white py-16 text-center">
        <svg className="mb-3 h-10 w-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
          />
        </svg>
        <p className="text-sm font-medium text-slate-600">{tBcp.emptyEventsTitle}</p>
        <p className="mt-1 text-xs text-slate-400">{tBcp.emptyEventsBody}</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="w-8 px-2 py-2"></th>
            <th className="px-3 py-2 text-left">{tBcp.colAlertType}</th>
            <th className="px-3 py-2 text-left">{tBcp.colIssuedAt}</th>
            <th className="px-3 py-2 text-left">{tBcp.colArea}</th>
            <th className="px-3 py-2 text-left">{tBcp.colIntensity}</th>
            <th className="px-3 py-2 text-left">{tBcp.colStoreCount}</th>
            <th className="px-3 py-2 text-left">{tBcp.colStatus}</th>
            <th className="px-3 py-2 text-left">PDF</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const isOpen = expanded.has(g.key)
            // F42: how many child events in this alert have a PDF report
            const pdfCount = g.stores.reduce(
              (n, s) => n + (reportByEventId.get(s.id)?.pdf_url ? 1 : 0),
              0,
            )
            return (
              <FragmentRows
                key={g.key}
                g={g}
                isOpen={isOpen}
                onToggle={() => toggle(g.key)}
                tBcp={tBcp}
                lang={lang}
                reportByEventId={reportByEventId}
                pdfCount={pdfCount}
              />
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FragmentRows({
  g, isOpen, onToggle, tBcp, lang, reportByEventId, pdfCount,
}: {
  g:               AlertGroup
  isOpen:          boolean
  onToggle:        () => void
  tBcp:            Msg['bcpDashboard']
  /** F40.4: passed instead of relying on tBcp.storeCountValue (function) */
  lang:            string
  reportByEventId: Map<string, BcpReportLite>
  pdfCount:        number
}) {
  return (
    <>
      {/* ── Parent row (alert summary) ────────────────────────────────────── */}
      <tr
        className={
          'cursor-pointer border-t border-slate-100 transition-colors ' +
          (isOpen ? 'bg-blue-50/40' : 'hover:bg-slate-50')
        }
        onClick={onToggle}
      >
        <td className="px-2 py-2 align-middle text-center">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggle() }}
            aria-label={isOpen ? tBcp.collapseAria : tBcp.expandAria}
            aria-expanded={isOpen}
            className="flex h-5 w-5 items-center justify-center rounded text-slate-500 hover:bg-slate-200"
          >
            <svg
              width="10" height="10" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round"
              className={'transition-transform ' + (isOpen ? 'rotate-90' : '')}
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </td>
        <td className="px-3 py-2 font-medium text-slate-800">
          {alertTypeLabel(g.alert_type, tBcp)}
        </td>
        <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
          {fmtJST(g.alert_issued_at)}
        </td>
        <td className="px-3 py-2 text-slate-500">
          <span className="font-mono">{g.area_code ?? '—'}</span>
          {prefName(g.area_code) && (
            <span className="ml-1.5 text-slate-600">{prefName(g.area_code)}</span>
          )}
        </td>
        <td className="px-3 py-2 font-medium text-slate-700">
          {jmaIntensityLabel(g.max_intensity) ?? '—'}
        </td>
        <td className="px-3 py-2 font-mono tabular-nums">
          {/* F40.4: no more function-valued message dereference — pure inline
              format based on lang. Immune to "is not a function" regardless
              of which MESSAGES version Turbopack happens to be serving. */}
          {fmtStoreCount(lang, g.stores.length)}
        </td>
        <td className="px-3 py-2">
          <span className={
            'inline-block rounded px-2 py-0.5 text-[11px] font-semibold ' +
            (STATUS_STYLE[g.aggregated_status] ?? 'bg-slate-200 text-slate-600')
          }>
            {statusLabel(g.aggregated_status, tBcp)}
          </span>
        </td>
        <td className="px-3 py-2 font-mono tabular-nums text-slate-500">
          {pdfCount > 0 ? `${pdfCount}/${g.stores.length}` : '—'}
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center justify-end gap-2">
            {g.is_test && (
              <span className="inline-block rounded bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
                {tBcp.testBadge}
              </span>
            )}
            {/* F111: テスト発令のみ削除可。親行=1発令なので配下の全 event を削除。 */}
            {g.is_test && (
              <TestDeleteButton
                eventIds={g.stores.map((s) => s.id)}
                label={alertTypeLabel(g.alert_type, tBcp)}
                issuedAt={fmtJST(g.alert_issued_at)}
              />
            )}
          </div>
        </td>
      </tr>

      {/* ── Child rows (per store) ──────────────────────────────────────── */}
      {isOpen && g.stores.map((s) => {
        const rep = reportByEventId.get(s.id)
        return (
          <tr key={s.id} className="border-t border-slate-100 bg-slate-50/50">
            <td className="px-2 py-1.5"></td>
            <td className="px-3 py-1.5 pl-8 text-slate-700">
              <span className="text-slate-400">└</span>{' '}
              {s.store_name ?? '—'}
            </td>
            <td className="px-3 py-1.5"></td>
            <td className="px-3 py-1.5"></td>
            <td className="px-3 py-1.5"></td>
            <td className="px-3 py-1.5"></td>
            <td className="px-3 py-1.5">
              <span className={
                'inline-block rounded px-2 py-0.5 text-[11px] font-semibold ' +
                (STATUS_STYLE[s.status] ?? 'bg-slate-200 text-slate-600')
              }>
                {statusLabel(s.status, tBcp)}
              </span>
            </td>
            <td className="px-3 py-1.5">
              {rep?.pdf_url ? (
                <a
                  href={rep.pdf_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-100"
                  onClick={(e) => e.stopPropagation()}
                  title={rep.sent_to_emails?.length ? `送信先: ${rep.sent_to_emails.join(', ')}` : undefined}
                >
                  <FileText size={12} strokeWidth={1.5} aria-hidden /> PDF
                </a>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </td>
            <td className="px-3 py-1.5 text-right">
              <Link
                href={`/bcp/${s.id}`}
                className="text-blue-600 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {tBcp.detail}
              </Link>
            </td>
          </tr>
        )
      })}
    </>
  )
}

// F111: テスト発令削除ボタン。is_test=true のアラート (= 1 親行) 配下の全
// bcp_event を確認ダイアログ付きで削除する。本番アラートには表示されない。
function TestDeleteButton({
  eventIds,
  label,
  issuedAt,
}: {
  eventIds: string[]
  label:    string
  issuedAt: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function onDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm(`テスト発令「${label} / ${issuedAt}」を削除します。\n配下の ${eventIds.length} 件のイベント・スナップショット・PDF も完全に消えます。元に戻せません。よろしいですか？`)) {
      return
    }
    setBusy(true)
    const res = await fetch('/api/bcp/events', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ eventIds }),
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      alert(`削除失敗: ${j.error ?? res.status}${j.message ? `\n${j.message}` : ''}`)
      return
    }
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      title="このテスト発令を削除"
      className="flex h-6 w-6 items-center justify-center rounded border border-red-200 bg-white text-red-500 hover:bg-red-50 disabled:opacity-50"
    >
      {busy ? (
        <span className="text-[10px]">…</span>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      )}
    </button>
  )
}
