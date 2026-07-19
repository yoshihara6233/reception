/**
 * /baggage/[id] — 検査詳細（M4・SCREEN H v2: 2カメラ再生を主役）
 *
 * 上部大面積 = 2カメラ同期プレイヤー（共有スクラバ＋検査窓ハイライト・OV#4）。
 * 下段 = 顔3枚比較列（入室/退出/従業員マスタ・「同一人物か」の目視列）＋メタ。
 * 本ページの閲覧は footage_access_log（baggage_view）に記録される（G3）。
 */
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { recordFootageAccess } from '@/lib/audit/footage-access'
import { BAGGAGE_NAV, BAGGAGE_NAV_TITLE } from '../nav'
import { sessionBadge, AUTH_SKIPPED_BADGE } from '@/lib/baggage/status'
import { SessionPlayer, type PlayerClip } from './SessionPlayer'
import { ConfirmButton } from './ConfirmButton'

interface ClipRow {
  id: string
  camera_id: string | null
  duration_sec: number | null
  clock_offset_sec: number | null
  upload_status: string
  recorder_cameras: { name: string } | null
}

const hms = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('ja-JP', { hour12: false, timeZone: 'Asia/Tokyo' }) : '—'

export default async function BaggageSessionPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  // RLS 越し: 見えないセッションは 404
  const { data: sess } = await supa
    .from('inspection_sessions')
    .select(`id, store_id, person_kind, visitor_name, visitor_company, entry_at, exit_at,
      entry_face_path, exit_face_path, card_photo_path, inspection_started_at, inspection_ended_at,
      status, auth_skipped, confirmed_at, inspection_date,
      employees ( name, face_photo_path ), stores ( name )`)
    .eq('id', id)
    .maybeSingle()
  if (!sess) notFound()

  const emp = (Array.isArray(sess.employees) ? sess.employees[0] : sess.employees) as
    { name: string; face_photo_path: string | null } | null
  const store = (Array.isArray(sess.stores) ? sess.stores[0] : sess.stores) as { name: string } | null

  const { data: clipRows } = await supa
    .from('inspection_clips')
    .select('id, camera_id, duration_sec, clock_offset_sec, upload_status, recorder_cameras ( name )')
    .eq('session_id', id)
    .order('created_at', { ascending: true })
  const clips = ((clipRows ?? []) as unknown[]).map((c) => {
    const row = c as Omit<ClipRow, 'recorder_cameras'> & { recorder_cameras: unknown }
    const cam = Array.isArray(row.recorder_cameras) ? row.recorder_cameras[0] : row.recorder_cameras
    return { ...row, recorder_cameras: (cam ?? null) as ClipRow['recorder_cameras'] }
  })

  // G3: 詳細ページ閲覧を記録（best-effort・5分dedup）
  await recordFootageAccess({
    actorUserId: user.id, storeId: sess.store_id, accessType: 'baggage_view', resourceId: id,
  })

  const playable: PlayerClip[] = clips
    .filter((c) => c.upload_status === 'done')
    .map((c) => ({
      id: c.id,
      cameraName: c.recorder_cameras?.name ?? 'カメラ',
      src: `/api/baggage/clips/${c.id}`,
      durationSec: c.duration_sec ? Number(c.duration_sec) : null,
    }))

  const windowSec = sess.inspection_started_at && sess.inspection_ended_at
    ? Math.max(0, (new Date(sess.inspection_ended_at).getTime() - new Date(sess.inspection_started_at).getTime()) / 1000)
    : null
  const maxOffset = clips
    .map((c) => (c.clock_offset_sec == null ? null : Number(c.clock_offset_sec)))
    .filter((v): v is number => v !== null)
    .sort((a, b) => Math.abs(b) - Math.abs(a))[0] ?? null

  const badge = sessionBadge(sess.status)
  const person = sess.person_kind === 'staff' ? (emp?.name ?? '（未特定）') : (sess.visitor_name ?? '（未特定）')

  const face = (kind: 'entry' | 'exit' | 'employee' | 'card', label: string, sub: string, path: string | null) => (
    <div key={kind} className="flex flex-1 items-center gap-3 rounded border border-slate-200 bg-white p-3 dark:border-gedline dark:bg-gedbg2">
      <div className="flex h-14 w-14 flex-none items-center justify-center overflow-hidden rounded bg-slate-200 text-[10px] text-slate-500 dark:bg-gedbg3 dark:text-gedink3">
        {path
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={`/api/baggage/sessions/${id}/photo?kind=${kind}`} alt={label} className="h-full w-full object-cover" />
          : 'なし'}
      </div>
      <div>
        <div className="text-[11px] text-slate-500 dark:text-gedink3">{label}</div>
        <div className="font-mono text-sm tabular-nums text-slate-800 dark:text-gedink">{sub}</div>
      </div>
    </div>
  )

  return (
    <AdminShell pathname="/baggage" nav={BAGGAGE_NAV} navTitle={BAGGAGE_NAV_TITLE}>
      <PageHeader
        title="検査詳細"
        crumb={[{ href: '/baggage', label: BAGGAGE_NAV_TITLE }, { href: `/baggage/${id}`, label: `${sess.inspection_date} ${person}` }]}
        actions={<ConfirmButton sessionId={id} confirmed={sess.confirmed_at !== null} />}
      />
      <div className="space-y-4 p-5">

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={
            'rounded px-2 py-0.5 text-[11px] font-medium ' +
            (badge.tone === 'ok' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
              : badge.tone === 'warn' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
              : badge.tone === 'bad' ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
              : 'bg-slate-200 text-slate-600 dark:bg-gedbg3 dark:text-gedink3')
          }>{badge.label}</span>
          {sess.auth_skipped && (
            <span className="rounded bg-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-gedbg3 dark:text-gedink3">
              {AUTH_SKIPPED_BADGE.label}
            </span>
          )}
          <span className="font-mono text-[12px] text-slate-500 dark:text-gedink3">#{id.slice(0, 8)}</span>
        </div>

        {/* 2カメラ同期プレイヤー（主役・OV#4） */}
        <SessionPlayer
          clips={playable}
          windowLabel={windowSec !== null
            ? `検査窓 ${Math.floor(windowSec / 60)}:${String(Math.round(windowSec % 60)).padStart(2, '0')}（±15s バッファ含む）`
            : 'クリップ処理中（エッジ切り出し待ち）'}
        />

        {/* 顔3枚比較列（同一人物かの目視・OV#13 は管理画面ではフルネーム可） */}
        <div className="flex flex-col gap-3 md:flex-row">
          {face('entry', '入室', hms(sess.entry_at), sess.entry_face_path)}
          {face('exit', '退出', hms(sess.exit_at), sess.exit_face_path)}
          {sess.person_kind === 'staff'
            ? face('employee', '従業員マスタ', emp?.name ?? '未登録', emp?.face_photo_path ?? null)
            : face('card', '名刺', sess.visitor_company ?? sess.visitor_name ?? '—', sess.card_photo_path)}
        </div>

        {/* メタ */}
        <div className="flex flex-wrap gap-6 border-t border-slate-200 pt-3 text-[13px] text-slate-700 dark:border-gedline dark:text-gedink2">
          <div><div className="text-[11px] text-slate-500 dark:text-gedink3">店舗</div>{store?.name ?? '—'}</div>
          <div><div className="text-[11px] text-slate-500 dark:text-gedink3">区分</div>{sess.person_kind === 'staff' ? '従業員' : '来訪者'}</div>
          <div><div className="text-[11px] text-slate-500 dark:text-gedink3">検査窓</div>
            <span className="font-mono tabular-nums">{hms(sess.inspection_started_at)} 〜 {hms(sess.inspection_ended_at)}</span></div>
          <div><div className="text-[11px] text-slate-500 dark:text-gedink3">NVR時刻差</div>
            <span className="font-mono tabular-nums">{maxOffset === null ? '—' : `${maxOffset >= 0 ? '+' : ''}${maxOffset}s`}</span></div>
          <div className="ml-auto self-end text-slate-500 dark:text-gedink3">この閲覧は監査ログに記録されます</div>
        </div>
      </div>
    </AdminShell>
  )
}
