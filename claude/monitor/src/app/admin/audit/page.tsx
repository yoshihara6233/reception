/**
 * /admin/audit — 監査ログ
 *
 * 全ユーザーの操作履歴 (live_sessions) を管理者向けに詳細表示。
 * ユーザー ID・店舗・モード・時刻・継続時間を一覧する。
 *
 * F23: live_sessions への INSERT は MonitorWorkspace（grid）/ LivePlayer / VodPlayer の
 * useEffect 内で /api/sessions 経由で行う。本ページはユーザーの auth.uid 経由で
 * RLS ポリシー sessions_select に従って読み出す（自分のセッション + tenant_admin/super_admin
 * は全件閲覧可）。
 */
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { getT } from '@/lib/i18n/server'
import type { Msg } from '@/lib/i18n/messages'

interface AuditRow {
  id: string
  user_id: string
  store_id: string
  camera_id: string | null
  mode: 'grid' | 'live' | 'vod'
  livekit_room: string | null
  vod_from: string | null
  vod_to: string | null
  started_at: string
  ended_at: string | null
  duration_sec: number | null
  stores: { id: string; name: string } | null
  recorder_cameras: { id: string; name: string; channel: number } | null
}

const MODE_STYLE: Record<string, string> = {
  grid: 'bg-blue-100 text-blue-700',
  live: 'bg-red-100 text-red-700',
  vod:  'bg-violet-100 text-violet-700',
}

function modeLabel(m: string, a: Msg['adminAudit']): string {
  switch (m) {
    case 'grid': return a.modeGrid
    case 'live': return a.modeLive
    case 'vod':  return a.modeVod
    default:     return m
  }
}

function fmtJST(iso: string) {
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

function fmtDuration(sec: number | null) {
  if (sec == null) return '—'
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m}m${s}s` : `${m}m`
}

function shortUuid(id: string) {
  return id.slice(0, 8) + '…'
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; page?: string }>
}) {
  const { mode, page: pageStr } = await searchParams
  const page = Math.max(1, parseInt(pageStr ?? '1', 10))
  const PAGE_SIZE = 100
  const offset = (page - 1) * PAGE_SIZE

  const supa = await createSupabaseServer()
  const t = await getT()
  const ta = t.adminAudit

  // Confirm admin access
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  let query = supa
    .from('live_sessions')
    .select(`
      id, user_id, store_id, camera_id, mode,
      livekit_room, vod_from, vod_to,
      started_at, ended_at, duration_sec,
      stores ( id, name ),
      recorder_cameras ( id, name, channel )
    `, { count: 'exact' })
    .order('started_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1)

  if (mode && ['grid', 'live', 'vod'].includes(mode)) {
    query = query.eq('mode', mode)
  }

  const { data, count } = await query
  const rows = (data ?? []) as unknown as AuditRow[]
  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE)

  const MODES = [
    { key: '',     label: ta.modeAll },
    { key: 'grid', label: ta.modeGrid },
    { key: 'live', label: ta.modeLive },
    { key: 'vod',  label: ta.modeVod  },
  ]

  return (
    <AdminShell pathname="/admin/audit" section="admin">
      <PageHeader
        title={ta.title}
        crumb={[
          { href: '/admin', label: t.breadcrumb.admin },
          { href: '/admin/audit', label: ta.title },
        ]}
      />

      <div className="px-5 py-4 space-y-4">

        {/* Summary */}
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs text-slate-600">
          {ta.totalSessions(count ?? 0)}
          {mode && (
            <span className="ml-1 text-slate-500">（{ta.filterPrefix} {modeLabel(mode, ta)}）</span>
          )}
        </div>

        {/* Mode filter */}
        <div className="flex gap-1">
          {MODES.map((m_) => {
            const active = (mode ?? '') === m_.key
            const href = m_.key ? `/admin/audit?mode=${m_.key}` : '/admin/audit'
            return (
              <a
                key={m_.key}
                href={href}
                className={
                  'rounded px-3 py-1.5 text-xs font-medium transition-colors ' +
                  (active
                    ? 'bg-slate-800 text-white'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-100')
                }
              >
                {m_.label}
              </a>
            )
          })}
        </div>

        {/* Audit table */}
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white py-16 text-center">
            <p className="text-sm font-medium text-slate-600">{ta.empty}</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">{ta.colUserId}</th>
                  <th className="px-3 py-2 text-left">{ta.colStore}</th>
                  <th className="px-3 py-2 text-left">{ta.colMode}</th>
                  <th className="px-3 py-2 text-left">{ta.colCamera}</th>
                  <th className="px-3 py-2 text-left">{ta.colStartedAt}</th>
                  <th className="px-3 py-2 text-left">{ta.colEndedAt}</th>
                  <th className="px-3 py-2 text-right">{ta.colDuration}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 font-mono text-slate-400" title={row.user_id}>
                      {shortUuid(row.user_id)}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {row.stores?.name ?? <span className="text-slate-400">{shortUuid(row.store_id)}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          'inline-block rounded px-2 py-0.5 text-[11px] font-semibold ' +
                          (MODE_STYLE[row.mode] ?? 'bg-slate-100 text-slate-600')
                        }
                      >
                        {modeLabel(row.mode, ta)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {row.recorder_cameras
                        ? `ch${String(row.recorder_cameras.channel).padStart(2, '0')} ${row.recorder_cameras.name}`
                        : t.common.dash}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                      {fmtJST(row.started_at)}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                      {row.ended_at ? fmtJST(row.ended_at) : (
                        <span className="text-emerald-600">{ta.sessionActive}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-slate-500">
                      {fmtDuration(row.duration_sec)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-3 py-2">
                <span className="text-[11px] text-slate-500">
                  {ta.pagination(page, totalPages)}
                </span>
                <div className="flex gap-1">
                  {page > 1 && (
                    <a
                      href={`/admin/audit?${mode ? `mode=${mode}&` : ''}page=${page - 1}`}
                      className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] hover:bg-slate-100"
                    >
                      {ta.prev}
                    </a>
                  )}
                  {page < totalPages && (
                    <a
                      href={`/admin/audit?${mode ? `mode=${mode}&` : ''}page=${page + 1}`}
                      className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] hover:bg-slate-100"
                    >
                      {ta.next}
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AdminShell>
  )
}
