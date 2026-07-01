/**
 * /alarms/[id] — 発報詳細（Phase B / PB7）
 *
 * 1 発報につき「店舗の全カメラ × 秒オフセット（-5 / 発生時 / +5 / +10 / +20 / +30 / +1分 / +3分）」の
 * 録画フレームをタイムライン表示する（エッジが録画から抽出し数分かけて埋める）。
 * さらにカメラを選んで:
 *   - ライブ（シングル）      … /stores/[id]/cam/[cameraId]/live
 *   - ライブ（16分割）        … /stores/[id]
 *   - 録画(VOD)              … /stores/[id]/cam/[cameraId]/vod（発報前後5分・録画対応のみ）
 * へ導線する。発生時の即時ライブスナップ（ingest 保存分）は先頭に表示。
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Video, Grid2x2, Film, Camera, ArrowLeft } from 'lucide-react'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell, ALARM_NAV } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { isVodVendor, type RecorderVendor } from '@/lib/types/db'
import { ALARM_TIMELINE_OFFSETS_SEC, offsetLabel } from '@/lib/alarms/timeline'
import { AlarmDetailActions } from './AlarmDetailActions'

const nameOf = (s: { name: string } | { name: string }[] | null | undefined) =>
  (Array.isArray(s) ? s[0]?.name : s?.name) ?? null
const first = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)
const arr = <T,>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : [])

function fmtJst(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}
const STATUS_LABEL: Record<string, string> = { new: '未対応', ack: '対応中', closed: '完了' }

type StoreCamera = { id: string; name: string; channel: number; vendor: RecorderVendor | null }

export default async function AlarmDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supa = await createSupabaseServer()

  const { data: ev } = await supa
    .from('alarm_events')
    .select('id, store_id, camera_id, source, event_type, occurred_at, snapshot_url, status, notified_at, stores ( name )')
    .eq('id', id)
    .maybeSingle()
  if (!ev) notFound()

  const storeName = nameOf((ev as { stores?: unknown }).stores as never) ?? '—'

  // 店舗の全カメラ（発報カメラ以外も含めタイムライン/選択の対象）。
  // カメラは store に直接紐づかない: edge_devices → recorders → recorder_cameras。
  const { data: edgeRows } = await supa
    .from('edge_devices')
    .select('recorders ( vendor, recorder_cameras ( id, name, channel ) )')
    .eq('store_id', ev.store_id)

  const cameras: StoreCamera[] = []
  for (const er of arr(edgeRows as { recorders?: unknown }[] | null)) {
    for (const rec of arr((er as { recorders?: unknown }).recorders as { vendor: RecorderVendor; recorder_cameras: unknown }[] | null)) {
      const vendor = (rec as { vendor: RecorderVendor }).vendor ?? null
      for (const c of arr((rec as { recorder_cameras?: unknown }).recorder_cameras as { id: string; name: string; channel: number }[] | null)) {
        cameras.push({ id: c.id, name: c.name, channel: c.channel, vendor })
      }
    }
  }
  cameras.sort((a, b) => a.channel - b.channel || a.name.localeCompare(b.name))

  // 抽出済みフレーム（(camera_id, offset_sec) → frameId）。
  const { data: frames } = await supa
    .from('alarm_frames')
    .select('id, camera_id, offset_sec')
    .eq('alarm_event_id', id)
  const frameMap = new Map<string, string>()
  for (const f of (frames ?? []) as { id: string; camera_id: string; offset_sec: number }[]) {
    frameMap.set(`${f.camera_id}:${f.offset_sec}`, f.id)
  }
  const capturedCount = frameMap.size
  const totalExpected = cameras.length * ALARM_TIMELINE_OFFSETS_SEC.length

  const win = 5 * 60 * 1000
  const from = new Date(new Date(ev.occurred_at).getTime() - win).toISOString()
  const to = new Date(new Date(ev.occurred_at).getTime() + win).toISOString()
  const vodQuery = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&incident=${encodeURIComponent(ev.occurred_at)}`

  return (
    <AdminShell pathname="/alarms" nav={ALARM_NAV} navTitle="発報">
      <PageHeader title="発報詳細" crumb={[{ href: '/alarms', label: '発報' }, { href: `/alarms/${id}`, label: '詳細' }]} />
      <div className="space-y-4 px-5 py-4">
        <Link href="/alarms" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-gedaccent">
          <ArrowLeft size={13} strokeWidth={2} aria-hidden /> タイムラインへ戻る
        </Link>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
          {/* 発生時の即時スナップ */}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-gedline dark:bg-gedbg3">
            <div className="flex aspect-video items-center justify-center text-slate-400 dark:text-gedink3">
              {ev.snapshot_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={ev.snapshot_url} alt="発生時スナップ" className="h-full w-full object-cover" />
                : <Camera size={28} strokeWidth={1.5} aria-hidden />}
            </div>
          </div>

          {/* 情報 + 確認操作 */}
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
            <dl className="grid grid-cols-[100px_1fr] gap-y-1.5 text-[13px]">
              <dt className="text-slate-500 dark:text-gedink3">店舗</dt><dd className="font-medium text-slate-800 dark:text-gedink">{storeName}</dd>
              <dt className="text-slate-500 dark:text-gedink3">種別</dt><dd className="text-slate-700 dark:text-gedink">{ev.event_type || ev.source}</dd>
              <dt className="text-slate-500 dark:text-gedink3">発報時刻</dt><dd className="font-mono tabular-nums text-slate-700 dark:text-gedink">{fmtJst(ev.occurred_at)}</dd>
              <dt className="text-slate-500 dark:text-gedink3">源</dt><dd className="text-slate-700 dark:text-gedink">{ev.source}{ev.notified_at ? ' ・ 通知済' : ''}</dd>
              <dt className="text-slate-500 dark:text-gedink3">状態</dt><dd className="text-slate-700 dark:text-gedink">{STATUS_LABEL[ev.status] ?? ev.status}</dd>
            </dl>
            <div className="mt-3 border-t border-slate-100 pt-3 dark:border-gedline">
              <AlarmDetailActions eventId={ev.id} status={ev.status} />
            </div>
          </div>
        </div>

        {/* 発報前後スナップ タイムライン（店舗全カメラ × オフセット） */}
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">
              発報前後スナップ（−5秒=録画 / 発生時以降=ライブ）
            </div>
            <div className="text-[11px] text-slate-400 dark:text-gedink3">
              {capturedCount} / {totalExpected} 枚
              {capturedCount < totalExpected && <span className="ml-1">・収集中（最大約 3 分）</span>}
            </div>
          </div>

          {cameras.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-gedink3">この店舗にカメラが登録されていません。</p>
          ) : (
            <div className="space-y-4">
              {cameras.map((cam) => (
                <div key={cam.id}>
                  <div className="mb-1.5 text-[12px] font-medium text-slate-700 dark:text-gedink">{cam.name}</div>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
                    {ALARM_TIMELINE_OFFSETS_SEC.map((off) => {
                      const frameId = frameMap.get(`${cam.id}:${off}`)
                      const isZero = off === 0
                      return (
                        <div key={off} className="space-y-1">
                          <div className={`overflow-hidden rounded border bg-slate-100 dark:bg-gedbg3 ${isZero ? 'border-slate-400 dark:border-gedaccent' : 'border-slate-200 dark:border-gedline'}`}>
                            <div className="flex aspect-video items-center justify-center">
                              {frameId
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={`/api/alarms/frames/${frameId}/image`} alt={`${cam.name} ${offsetLabel(off)}`} className="h-full w-full object-cover" />
                                : <span className="text-[10px] text-slate-400 dark:text-gedink3">収集中</span>}
                            </div>
                          </div>
                          <div className={`text-center text-[10px] tabular-nums ${isZero ? 'font-bold text-slate-700 dark:text-gedink' : 'text-slate-500 dark:text-gedink3'}`}>
                            {offsetLabel(off)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* カメラ選択 → ライブ / 16分割 / 録画 */}
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">映像を確認</div>
            <Link href={`/stores/${ev.store_id}`} className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-gedline dark:text-gedink">
              <Grid2x2 size={14} strokeWidth={2} aria-hidden /> 16分割ライブ
            </Link>
          </div>
          {cameras.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-gedink3">カメラ未登録のためライブ／録画は利用できません。</p>
          ) : (
            <div className="overflow-hidden rounded border border-slate-200 dark:border-gedline">
              <table className="w-full text-[13px]">
                <tbody>
                  {cameras.map((cam) => {
                    const canVod = !!cam.vendor && isVodVendor(cam.vendor)
                    return (
                      <tr key={cam.id} className="border-b border-slate-100 last:border-0 dark:border-gedline">
                        <td className="px-3 py-2 text-slate-700 dark:text-gedink">{cam.name}</td>
                        <td className="px-3 py-2 text-right">
                          <div className="inline-flex gap-2">
                            <Link href={`/stores/${ev.store_id}/cam/${cam.id}/live`} className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-gedaccent dark:text-gedbg">
                              <Video size={14} strokeWidth={2} aria-hidden /> ライブ
                            </Link>
                            {canVod ? (
                              <Link href={`/stores/${ev.store_id}/cam/${cam.id}/vod?${vodQuery}`} className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-gedline dark:text-gedink">
                                <Film size={14} strokeWidth={2} aria-hidden /> 録画
                              </Link>
                            ) : (
                              <span className="inline-flex items-center px-3 py-1.5 text-[11px] text-slate-400 dark:text-gedink3">録画非対応</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </AdminShell>
  )
}
