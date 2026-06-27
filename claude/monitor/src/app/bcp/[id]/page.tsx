/**
 * /bcp/[id] — BCP Event Detail Page
 *
 * Shows full detail for a single BCP event:
 *  - Event info card (alert type, area, store, status, timestamps)
 *  - Camera clips table (status, download link when available)
 *  - Report section (PDF download if generated)
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { GenerateReportButton } from './GenerateReportButton'
import { RetrieveRecordingButton } from './RetrieveRecordingButton'

interface BcpEvent {
  id: string
  alert_type: string
  alert_issued_at: string
  area_code: string | null
  status: string
  is_test: boolean
  created_at: string
  stores: { id: string; name: string } | null
}

interface BcpClip {
  id: string
  event_id: string
  camera_id: string
  // F40: offset_min = -5, 0, 5, 10, 15, 20, 25, 30 (null for legacy video clips)
  offset_min: number | null
  clip_from: string
  clip_to: string
  // F76: storage_path is the new source of truth. clip_url / thumbnail_url
  // stay populated for pre-F76 rows; rendering prefers `/api/bcp/clip/[id]`
  // regardless and the API decides which to use.
  storage_path: string | null
  clip_url: string | null
  thumbnail_url: string | null
  duration_sec: number | null
  upload_status: string
  created_at: string
  recorder_cameras: { id: string; name: string } | null
}

// F40: snapshot timeline offsets in minutes
const SNAPSHOT_OFFSETS = [-5, 0, 5, 10, 15, 20, 25, 30] as const
function offsetLabel(min: number): string {
  if (min === 0)  return '発生時'
  if (min < 0)    return `${Math.abs(min)}分前`
  return `${min}分後`
}
/** 発令時刻 + オフセット分 の実時刻を HH:MM(JST) で返す。 */
function offsetClock(alertIso: string, min: number): string {
  const t = Date.parse(alertIso)
  if (isNaN(t)) return ''
  return new Date(t + min * 60_000).toLocaleTimeString('ja-JP', {
    timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit',
  })
}

interface BcpReport {
  id: string
  event_id: string
  pdf_url: string | null
  generated_at: string | null
  sent_to_emails: string[] | null
  created_at: string
}

const STATUS_STYLE: Record<string, string> = {
  pending:          'bg-yellow-100 text-yellow-700',
  recording:        'bg-orange-100 text-orange-700',
  clips_uploaded:   'bg-blue-100 text-blue-700',
  report_generated: 'bg-blue-100 text-blue-700',
  completed:        'bg-emerald-100 text-emerald-700',
  failed:           'bg-red-100 text-red-700',
}

const STATUS_LABEL: Record<string, string> = {
  pending:          '録画未取得',
  recording:        '取得中',
  clips_uploaded:   'アップロード済',
  report_generated: '報告書生成済',
  completed:        '完了',
  failed:           '失敗',
}

const ALERT_TYPE_LABEL: Record<string, string> = {
  tsunami:    '津波情報',
  earthquake: '震度情報',
  missile:    'ミサイル情報',
  test:       'テスト',
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default async function BcpEventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supa = await createSupabaseServer()

  // Fetch event
  const { data: eventData, error: eventError } = await supa
    .from('bcp_events')
    .select('id, alert_type, alert_issued_at, area_code, status, is_test, created_at, stores ( id, name )')
    .eq('id', id)
    .single()

  if (eventError || !eventData) {
    notFound()
  }

  const event = eventData as unknown as BcpEvent

  // Fetch clips (= snapshots) with camera names
  const { data: clipsData } = await supa
    .from('bcp_clips')
    .select(`
      id, event_id, camera_id, offset_min, clip_from, clip_to,
      storage_path, clip_url, thumbnail_url,
      duration_sec, upload_status, created_at,
      recorder_cameras ( id, name )
    `)
    .eq('event_id', id)
    .order('camera_id', { ascending: true })
    .order('offset_min', { ascending: true, nullsFirst: true })

  const clips = (clipsData ?? []) as unknown as BcpClip[]

  // F40: group snapshots by camera; one card per camera with 8-thumbnail timeline.
  // Legacy video clips (offset_min IS NULL) are grouped under a "legacy" bucket
  // and rendered at the bottom with a smaller card.
  const byCamera = new Map<string, { name: string; snapshots: BcpClip[]; legacy: BcpClip[] }>()
  for (const c of clips) {
    const camId   = c.camera_id
    const camName = c.recorder_cameras?.name ?? '(unknown camera)'
    let g = byCamera.get(camId)
    if (!g) { g = { name: camName, snapshots: [], legacy: [] }; byCamera.set(camId, g) }
    if (c.offset_min == null) g.legacy.push(c)
    else                       g.snapshots.push(c)
  }
  const cameraGroups = [...byCamera.entries()].map(([camId, g]) => ({ camId, ...g }))

  // Fetch the latest report (if any). A new bcp_reports row is inserted on each
  // successful webhook/generate run, so an event can have MORE THAN ONE report
  // row — `.single()` would error on duplicates and hide the PDF download link.
  // Take the most recent by created_at instead. See investigate 2026-06-27.
  const { data: reportData } = await supa
    .from('bcp_reports')
    .select('id, event_id, pdf_url, generated_at, sent_to_emails, created_at')
    .eq('event_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const report = reportData as BcpReport | null

  const alertTypeLabel = ALERT_TYPE_LABEL[event.alert_type] ?? event.alert_type

  return (
    <AdminShell pathname="/bcp" section="bcp">
      <PageHeader
        title={`BCPイベント詳細`}
        crumb={[
          { href: '/bcp', label: 'BCP' },
          { href: `/bcp/${id}`, label: 'イベント詳細' },
        ]}
      />

      <div className="space-y-5 px-5 py-4">
        {/* Back button */}
        <Link
          href="/bcp"
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          BCP一覧に戻る
        </Link>

        {/* Event info card */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-900">イベント情報</h2>
            <div className="flex items-center gap-2">
              {event.is_test && (
                <span className="inline-block rounded bg-purple-100 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
                  テスト
                </span>
              )}
              <span
                className={
                  'inline-block rounded px-2 py-0.5 text-[11px] font-semibold ' +
                  (STATUS_STYLE[event.status] ?? 'bg-slate-200 text-slate-600')
                }
              >
                {STATUS_LABEL[event.status] ?? event.status}
              </span>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-0 divide-y divide-slate-100 px-4 text-xs md:grid-cols-4 md:divide-y-0 md:divide-x">
            <div className="py-3">
              <dt className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">店舗名</dt>
              <dd className="font-medium text-slate-800">{event.stores?.name ?? '—'}</dd>
            </div>
            <div className="py-3 md:px-4">
              <dt className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">アラート種別</dt>
              <dd className="font-medium text-slate-800">{alertTypeLabel}</dd>
            </div>
            <div className="py-3 md:px-4">
              <dt className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">発令日時</dt>
              <dd className="text-slate-700">{fmtDateTime(event.alert_issued_at)}</dd>
            </div>
            <div className="py-3 md:px-4">
              <dt className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">エリアコード</dt>
              <dd className="font-mono text-slate-700">{event.area_code ?? '—'}</dd>
            </div>
          </dl>
        </div>

        {/* 現地レコーダ 録画取得（発令時に自動・このボタンは手動再取得用） */}
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50/40">
          <div className="border-b border-red-100 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-900">現地レコーダ 録画取得（手動・再取得用）</h2>
          </div>
          <div className="px-4 py-4">
            <RetrieveRecordingButton eventId={event.id} alreadyHasClips={clips.length > 0} />
          </div>
        </div>

        {/* F40: Snapshot timeline section (1 card per camera, 8 thumbnails each) */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-900">
              スナップショット タイムライン
              <span className="ml-2 text-xs font-normal text-slate-500">
                ({cameraGroups.length} カメラ × 8 枚)
              </span>
            </h2>
            {/* Bulk download — opens each public URL in a new tab. The user can
                also right-click each thumbnail to save individually. */}
            <a
              href={`/api/bcp/${id}/snapshots.zip`}
              className="inline-flex items-center gap-1 rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-900"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              全 JPEG を ZIP でダウンロード
            </a>
          </div>

          {cameraGroups.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-400">
              スナップショットはまだありません。発令時に自動取得されますが、表示されない場合は上の「現地レコーダの録画を取得」で手動取得できます。
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {cameraGroups.map((g) => (
                <div key={g.camId} className="px-4 py-3">
                  {/* Camera header */}
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-slate-800">
                      📷 {g.name}
                    </h3>
                    {g.snapshots.length > 0 && (
                      <span className="text-[10px] text-slate-400">
                        {g.snapshots.filter((s) => s.upload_status === 'completed').length} / {SNAPSHOT_OFFSETS.length} 取得済
                      </span>
                    )}
                  </div>

                  {/* 8-thumbnail timeline grid */}
                  <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
                    {SNAPSHOT_OFFSETS.map((offset) => {
                      const snap = g.snapshots.find((s) => s.offset_min === offset)
                      const isCenterpiece = offset === 0
                      return (
                        <div
                          key={offset}
                          className={
                            'group relative overflow-hidden rounded border ' +
                            (isCenterpiece
                              ? 'border-red-300 ring-2 ring-red-200'
                              : 'border-slate-200')
                          }
                        >
                          {snap && (snap.storage_path || snap.clip_url) ? (
                            // F76: route through /api/bcp/clip/<id> instead of using
                            // the raw clip_url. The API verifies the session and
                            // redirects to a short-lived signed URL, so the
                            // bcp-clips bucket can be Private.
                            <a
                              href={`/api/bcp/clip/${snap.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block aspect-[4/3] bg-slate-900"
                              title={`${offsetLabel(offset)} — クリックで原寸表示 / 右クリックで保存`}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`/api/bcp/clip/${snap.id}`}
                                alt={`${g.name} ${offsetLabel(offset)}`}
                                className="h-full w-full object-cover transition-transform group-hover:scale-105"
                              />
                            </a>
                          ) : (
                            <div className="flex aspect-[4/3] items-center justify-center bg-slate-100 text-[10px] text-slate-400">
                              未取得
                            </div>
                          )}
                          <div
                            className={
                              'absolute bottom-0 left-0 right-0 px-1.5 py-0.5 text-center text-[10px] font-semibold ' +
                              (isCenterpiece
                                ? 'bg-red-600/80 text-white'
                                : 'bg-black/55 text-white')
                            }
                          >
                            {offsetLabel(offset)}
                            <span className="ml-1 font-normal opacity-90">({offsetClock(event.alert_issued_at, offset)})</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Per-camera download links */}
                  {g.snapshots.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                      <span>個別 DL:</span>
                      {SNAPSHOT_OFFSETS.map((offset) => {
                        const snap = g.snapshots.find((s) => s.offset_min === offset)
                        if (!snap || (!snap.storage_path && !snap.clip_url)) return null
                        return (
                          <a
                            key={offset}
                            // F76: signed URL proxy. The browser follows the redirect
                            // and the `download` attribute hint stays effective even
                            // though the final URL is on supabase.co (the proxy
                            // doesn't strip it).
                            href={`/api/bcp/clip/${snap.id}`}
                            download={`${g.name}_${offsetLabel(offset)}.jpg`}
                            className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600 hover:bg-slate-200"
                          >
                            {offsetLabel(offset)} ({offsetClock(event.alert_issued_at, offset)})
                          </a>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Report section */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-bold text-slate-900">BCPレポート</h2>
          </div>

          <div className="space-y-4 px-4 py-4">
            {/* Existing PDF download (if any) */}
            {report ? (
              <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-xs">
                  <p className="text-slate-600">
                    最終生成: {fmtDateTime(report.generated_at)}
                  </p>
                  {report.sent_to_emails && report.sent_to_emails.length > 0 && (
                    <p className="mt-0.5 text-slate-500">
                      送信先: {report.sent_to_emails.join(', ')}
                    </p>
                  )}
                </div>
                {report.pdf_url ? (
                  <a
                    href={report.pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    PDF ダウンロード
                  </a>
                ) : (
                  <span className="text-xs text-slate-400">PDFは生成中です</span>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                レポートはまだ生成されていません。8 枚スナップショット (T-5〜T+30) のアップロードが
                完了すると PDF が自動生成され、完了メールが送信されます
                （下のボタンで手動生成・再生成も可能）。
              </p>
            )}

            {/* Always-available generate / re-generate button */}
            <div className="border-t border-slate-100 pt-3">
              <GenerateReportButton
                eventId={event.id}
                buttonLabel={report ? '📄 PDF を再生成' : '📄 PDF を生成'}
                hintMessage={
                  report
                    ? '撮影が進んだ最新の状態で PDF を再作成します (旧 PDF は上書き)'
                    : '撮影済みスナップショットから PDF を作成します'
                }
              />
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  )
}
