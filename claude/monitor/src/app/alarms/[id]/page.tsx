/**
 * /alarms/[id] — 発報詳細（Phase B / PB7・BCP詳細と同形の表示）
 *
 * 1 発報につき「店舗の全カメラ × 秒オフセット（-5 / 発生時 / +5 / +10 / +20 / +30 / +1分 / +3分）」の
 * スナップを、BCP詳細（/bcp/[id]）同様に「カメラ毎の8枚タイムライン」で表示する。
 * 取得方式は -5秒=録画抽出 / 発生時以降=ライブ。さらにカメラを選んで:
 *   - ライブ（シングル）      … /stores/[id]/cam/[cameraId]/live
 *   - ライブ（16分割）        … /stores/[id]
 *   - 録画(VOD)              … /stores/[id]/cam/[cameraId]/vod（発報前後5分・録画対応のみ）
 * へ導線する。単一カメラのサムネイル（発生時の1枚）は表示しない。
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Video, Grid2x2, Film, Camera, ArrowLeft } from 'lucide-react'
import { createSupabaseServer } from '@/lib/supabase/server'
import { recordFootageAccess } from '@/lib/audit/footage-access'
import { AdminShell, ALARM_NAV } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { isVodVendor, type RecorderVendor } from '@/lib/types/db'
import { ALARM_TIMELINE_OFFSETS_SEC, offsetLabel } from '@/lib/alarms/timeline'
import { AlarmDetailActions } from './AlarmDetailActions'

const nameOf = (s: { name: string } | { name: string }[] | null | undefined) =>
  (Array.isArray(s) ? s[0]?.name : s?.name) ?? null
const arr = <T,>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : [])

function fmtJst(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
/** 発報時刻 + オフセット秒 の実時刻を HH:MM:SS(JST) で返す。 */
function offsetClock(occurredIso: string, sec: number): string {
  const t = Date.parse(occurredIso)
  if (isNaN(t)) return ''
  return new Date(t + sec * 1000).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
const STATUS = {
  new:    { label: '未対応', cls: 'bg-red-100 text-red-700 dark:bg-[#A3332B]/25 dark:text-[#E87D74]' },
  ack:    { label: '対応中', cls: 'bg-amber-100 text-amber-700 dark:bg-[#B5761A]/20 dark:text-[#E2A55A]' },
  closed: { label: '完了',   cls: 'bg-slate-100 text-slate-500 dark:bg-gedbg3 dark:text-gedink3' },
}

type StoreCamera = { id: string; name: string; channel: number; vendor: RecorderVendor | null }

export default async function AlarmDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supa = await createSupabaseServer()

  const { data: ev } = await supa
    .from('alarm_events')
    .select('id, store_id, camera_id, source, event_type, occurred_at, status, notified_at, stores ( name )')
    .eq('id', id)
    .maybeSingle()
  if (!ev) notFound()

  // G3: 発報詳細（証跡映像）を開いた閲覧アクセスを記録（ページ表示時＝画像キャッシュに依存せず確実）。
  const { data: { user } } = await supa.auth.getUser()
  if (user) {
    await recordFootageAccess({
      actorUserId: user.id, storeId: ev.store_id as string | null,
      accessType: 'alarm_frame', resourceId: id, cameraId: ev.camera_id as string | null,
    })
  }

  const storeName = nameOf((ev as { stores?: unknown }).stores as never) ?? '—'
  const st = STATUS[ev.status as 'new' | 'ack' | 'closed'] ?? STATUS.new

  // 店舗の全カメラ（edge_devices → recorders → recorder_cameras）。
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

  const card = 'overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-gedline dark:bg-gedbg2'
  const cardHead = 'flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-gedline'
  const h2 = 'text-sm font-bold text-slate-900 dark:text-gedink'

  return (
    <AdminShell pathname="/alarms" nav={ALARM_NAV} navTitle="ALARM">
      <PageHeader title="発報詳細" crumb={[{ href: '/alarms', label: 'ALARM' }, { href: `/alarms/${id}`, label: '詳細' }]} />
      <div className="space-y-5 px-5 py-4">
        <Link href="/alarms" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-gedaccent">
          <ArrowLeft size={13} strokeWidth={2} aria-hidden /> 発報一覧に戻る
        </Link>

        {/* 発報情報カード */}
        <div className={card}>
          <div className={cardHead}>
            <h2 className={h2}>発報情報</h2>
            <div className="flex items-center gap-2">
              {ev.notified_at && <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-[#2F7A4F]/25 dark:text-[#5CC98B]">通知済</span>}
              <span className={'inline-block rounded px-2 py-0.5 text-[11px] font-semibold ' + st.cls}>{st.label}</span>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-0 divide-y divide-slate-100 px-4 text-xs md:grid-cols-4 md:divide-y-0 md:divide-x dark:divide-gedline">
            <div className="py-3">
              <dt className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-gedink3">店舗名</dt>
              <dd className="font-medium text-slate-800 dark:text-gedink">{storeName}</dd>
            </div>
            <div className="py-3 md:px-4">
              <dt className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-gedink3">種別</dt>
              <dd className="font-medium text-slate-800 dark:text-gedink">{ev.event_type || ev.source}</dd>
            </div>
            <div className="py-3 md:px-4">
              <dt className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-gedink3">発報日時</dt>
              <dd className="text-slate-700 dark:text-gedink2">{fmtJst(ev.occurred_at)}</dd>
            </div>
            <div className="py-3 md:px-4">
              <dt className="mb-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-gedink3">源</dt>
              <dd className="text-slate-700 dark:text-gedink2">{ev.source}</dd>
            </div>
          </dl>
          <div className="border-t border-slate-100 px-4 py-3 dark:border-gedline">
            <AlarmDetailActions eventId={ev.id} status={ev.status} />
          </div>
        </div>

        {/* 発報前後スナップ タイムライン（カメラ毎に8枚・BCP詳細と同形） */}
        <div className={card}>
          <div className={cardHead}>
            <h2 className={h2}>
              発報前後スナップ タイムライン
              <span className="ml-2 text-xs font-normal text-slate-500 dark:text-gedink3">
                ({cameras.length} カメラ × {ALARM_TIMELINE_OFFSETS_SEC.length} 枚 ・ −5秒=録画 / 発生時以降=ライブ)
              </span>
            </h2>
            <span className="text-[11px] text-slate-400 dark:text-gedink3">
              {capturedCount} / {totalExpected} 枚{capturedCount < totalExpected && ' ・ 収集中（最大約 3 分）'}
            </span>
          </div>

          {cameras.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-400 dark:text-gedink3">
              この店舗にカメラが登録されていません。
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-gedline">
              {cameras.map((cam) => {
                const got = ALARM_TIMELINE_OFFSETS_SEC.filter((o) => frameMap.has(`${cam.id}:${o}`)).length
                return (
                  <div key={cam.id} className="px-4 py-3">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-gedink">
                        <Camera size={13} strokeWidth={1.5} aria-hidden /> {cam.name}
                      </h3>
                      <span className="text-[10px] text-slate-400 dark:text-gedink3">{got} / {ALARM_TIMELINE_OFFSETS_SEC.length} 取得済</span>
                    </div>
                    <div className="grid grid-cols-4 gap-2 md:grid-cols-8">
                      {ALARM_TIMELINE_OFFSETS_SEC.map((off) => {
                        const frameId = frameMap.get(`${cam.id}:${off}`)
                        const isZero = off === 0
                        return (
                          <div key={off} className={'group relative overflow-hidden rounded border ' + (isZero ? 'border-red-300 ring-2 ring-red-200 dark:border-[#A3332B] dark:ring-[#A3332B]/40' : 'border-slate-200 dark:border-gedline')}>
                            {frameId ? (
                              <a href={`/api/alarms/frames/${frameId}/image`} target="_blank" rel="noopener noreferrer" className="block aspect-[4/3] bg-slate-900" title={`${offsetLabel(off)} — クリックで原寸表示`}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={`/api/alarms/frames/${frameId}/image`} alt={`${cam.name} ${offsetLabel(off)}`} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                              </a>
                            ) : (
                              <div className="flex aspect-[4/3] items-center justify-center bg-slate-100 text-[10px] text-slate-400 dark:bg-gedbg3 dark:text-gedink3">収集中</div>
                            )}
                            <div className={'absolute bottom-0 left-0 right-0 px-1.5 py-0.5 text-center text-[10px] font-semibold ' + (isZero ? 'bg-red-600/80 text-white' : 'bg-black/55 text-white')}>
                              {offsetLabel(off)}<span className="ml-1 font-normal opacity-90">({offsetClock(ev.occurred_at, off)})</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 映像を確認（カメラ選択 → ライブ / 16分割 / 録画） */}
        <div className={card}>
          <div className={cardHead}>
            <h2 className={h2}>映像を確認</h2>
            <Link href={`/stores/${ev.store_id}`} className="inline-flex items-center gap-1.5 rounded border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-gedline dark:text-gedink">
              <Grid2x2 size={14} strokeWidth={2} aria-hidden /> 16分割ライブ
            </Link>
          </div>
          {cameras.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-slate-400 dark:text-gedink3">カメラ未登録のためライブ／録画は利用できません。</div>
          ) : (
            <table className="w-full text-[13px]">
              <tbody>
                {cameras.map((cam) => {
                  const canVod = !!cam.vendor && isVodVendor(cam.vendor)
                  return (
                    <tr key={cam.id} className="border-t border-slate-100 first:border-0 dark:border-gedline">
                      <td className="px-4 py-2 text-slate-700 dark:text-gedink">{cam.name}</td>
                      <td className="px-4 py-2 text-right">
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
          )}
        </div>
      </div>
    </AdminShell>
  )
}
