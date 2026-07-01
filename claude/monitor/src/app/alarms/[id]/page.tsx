/**
 * /alarms/[id] — 発報詳細（Phase B / PB6）
 *
 * 発報の内容を確認し、以下へ導線する:
 *   - ライブ表示（既存 /stores/.../live を再利用・どのカメラでも可）
 *   - 録画(VOD)：発報前後の録画再生（既存 /stores/.../vod を occurred_at±5分で・録画ありのみ）
 *   - 前後スナップ（〜10枚）は録画からのフレーム抽出（エッジ連携 PB5＋録画が前提）で追加予定
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Video, Film, Camera, ArrowLeft } from 'lucide-react'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell, ALARM_NAV } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { isVodVendor, type RecorderVendor } from '@/lib/types/db'
import { AlarmDetailActions } from './AlarmDetailActions'

const nameOf = (s: { name: string } | { name: string }[] | null | undefined) =>
  (Array.isArray(s) ? s[0]?.name : s?.name) ?? null
const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

function fmtJst(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
const STATUS_LABEL: Record<string, string> = { new: '未対応', ack: '対応中', closed: '完了' }

export default async function AlarmDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supa = await createSupabaseServer()

  const { data: ev } = await supa
    .from('alarm_events')
    .select('id, store_id, camera_id, source, event_type, occurred_at, snapshot_url, status, notified_at, stores ( name ), recorder_cameras ( name, recorders ( vendor ) )')
    .eq('id', id)
    .maybeSingle()
  if (!ev) notFound()

  const storeName = nameOf((ev as { stores?: unknown }).stores as never) ?? '—'
  const cam = first((ev as { recorder_cameras?: unknown }).recorder_cameras as { name: string; recorders: { vendor: RecorderVendor } | { vendor: RecorderVendor }[] } | null)
  const cameraName = cam?.name ?? null
  const vendor = first(cam?.recorders)?.vendor ?? null

  const canLive = !!ev.camera_id && !!ev.store_id
  const canVod = canLive && !!vendor && isVodVendor(vendor)

  const liveHref = `/stores/${ev.store_id}/cam/${ev.camera_id}/live`
  const win = 5 * 60 * 1000
  const from = new Date(new Date(ev.occurred_at).getTime() - win).toISOString()
  const to = new Date(new Date(ev.occurred_at).getTime() + win).toISOString()
  const vodHref = `/stores/${ev.store_id}/cam/${ev.camera_id}/vod?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&incident=${encodeURIComponent(ev.occurred_at)}`

  return (
    <AdminShell pathname="/alarms" nav={ALARM_NAV} navTitle="発報">
      <PageHeader title="発報詳細" crumb={[{ href: '/alarms', label: '発報' }, { href: `/alarms/${id}`, label: '詳細' }]} />
      <div className="space-y-4 px-5 py-4">
        <Link href="/alarms" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-gedaccent">
          <ArrowLeft size={13} strokeWidth={2} aria-hidden /> タイムラインへ戻る
        </Link>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
          {/* スナップ */}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-gedline dark:bg-gedbg3">
            <div className="flex aspect-video items-center justify-center text-slate-400 dark:text-gedink3">
              {ev.snapshot_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={ev.snapshot_url} alt="" className="h-full w-full object-cover" />
                : <Camera size={28} strokeWidth={1.5} aria-hidden />}
            </div>
          </div>

          {/* 情報 + 導線 */}
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
              <dl className="grid grid-cols-[100px_1fr] gap-y-1.5 text-[13px]">
                <dt className="text-slate-500 dark:text-gedink3">店舗</dt><dd className="font-medium text-slate-800 dark:text-gedink">{storeName}</dd>
                <dt className="text-slate-500 dark:text-gedink3">カメラ</dt><dd className="text-slate-700 dark:text-gedink">{cameraName ?? '—'}</dd>
                <dt className="text-slate-500 dark:text-gedink3">種別</dt><dd className="text-slate-700 dark:text-gedink">{ev.event_type || ev.source}</dd>
                <dt className="text-slate-500 dark:text-gedink3">発報時刻</dt><dd className="font-mono tabular-nums text-slate-700 dark:text-gedink">{fmtJst(ev.occurred_at)}</dd>
                <dt className="text-slate-500 dark:text-gedink3">源</dt><dd className="text-slate-700 dark:text-gedink">{ev.source}{ev.notified_at ? ' ・ 通知済' : ''}</dd>
                <dt className="text-slate-500 dark:text-gedink3">状態</dt><dd className="text-slate-700 dark:text-gedink">{STATUS_LABEL[ev.status] ?? ev.status}</dd>
              </dl>
              <div className="mt-3 border-t border-slate-100 pt-3 dark:border-gedline">
                <AlarmDetailActions eventId={ev.id} status={ev.status} />
              </div>
            </div>

            {/* 映像導線 */}
            <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">映像を確認</div>
              <div className="flex flex-wrap gap-2">
                {canLive ? (
                  <Link href={liveHref} className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-gedaccent dark:text-gedbg">
                    <Video size={14} strokeWidth={2} aria-hidden /> ライブを見る
                  </Link>
                ) : <span className="text-xs text-slate-400">カメラ紐付けなし（ライブ不可）</span>}
                {canVod && (
                  <Link href={vodHref} className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-gedline dark:text-gedink">
                    <Film size={14} strokeWidth={2} aria-hidden /> 録画（発報前後5分）
                  </Link>
                )}
              </div>
              {!canVod && canLive && (
                <p className="mt-2 text-[11px] text-slate-400 dark:text-gedink3">
                  このカメラは録画（VOD）非対応のため、発報前後の録画・前後スナップは利用できません。
                </p>
              )}
              <p className="mt-2 text-[11px] text-slate-400 dark:text-gedink3">
                ※ 発報前後スナップ（〜10枚）は録画からのフレーム抽出で追加予定です。
              </p>
            </div>
          </div>
        </div>
      </div>
    </AdminShell>
  )
}
