/**
 * /admin/ops-audit — 運営アクセスログ（②運営管理・super_admin 専用）
 *
 * SaaS 運営者（super_admin）自身の行動履歴を全テナント横断で表示する。
 * テナント側の /admin/audit は「運営操作のテナント非開示」（PR#213）で
 * super_admin の行を隠すため、運営の説明責任はこのページが担う。
 *
 * - 視聴（live_sessions + footage_access_log）と 操作・設定変更（admin_audit_log）の 2 部構成
 * - 既定は super_admin 操作者のみ。?actor=all で全操作者の横断表示（全テナント）
 * - ②プレーンの原則どおり、ページ本体で super_admin ゲート必須（メニュー非表示だけに頼らない）
 */
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { AccessLogTable, type AccessRowVM } from '../audit/AccessLogTable'

interface SessionRow {
  id: string
  user_id: string
  store_id: string | null
  camera_id: string | null
  mode: 'grid' | 'live' | 'vod'
  started_at: string
  duration_sec: number | null
}
interface FootageRow {
  id: string
  actor_user_id: string
  store_id: string | null
  camera_id: string | null
  access_type: 'alarm_snapshot' | 'alarm_frame' | 'patrol_snapshot' | 'bcp_export' | 'patrol_view' | 'bcp_view'
  accessed_at: string
}
interface ChangeRow {
  id: number
  ts: string
  actor_user_id: string | null
  action: string
  target_type: string
  target_id: string | null
  store_id: string | null
  changes: unknown
}

const ACCESS_LIMIT = 300
const CHANGE_LIMIT = 200

function fmtJST(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export default async function OpsAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ actor?: string }>
}) {
  const { actor } = await searchParams
  const showAllActors = actor === 'all'

  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supa
    .from('admin_users')
    .select('role')
    .eq('auth_user_id', user.id)
    .single()
  // 運営アクセスログは super_admin 専用（②運営管理）。
  if (me?.role !== 'super_admin') notFound()

  // 全テナント横断のため service client（②プレーンは上のゲートで守る）。
  const svc = createSupabaseService()

  const { data: supers } = await svc
    .from('admin_users')
    .select('auth_user_id')
    .eq('role', 'super_admin')
  const superIds = (supers ?? []).map((s) => s.auth_user_id as string)

  let sessQuery = svc.from('live_sessions')
    .select('id, user_id, store_id, camera_id, mode, started_at, duration_sec')
    .order('started_at', { ascending: false }).limit(ACCESS_LIMIT)
  let footQuery = svc.from('footage_access_log')
    .select('id, actor_user_id, store_id, camera_id, access_type, accessed_at')
    .order('accessed_at', { ascending: false }).limit(ACCESS_LIMIT)
  let changeQuery = svc.from('admin_audit_log')
    .select('id, ts, actor_user_id, action, target_type, target_id, store_id, changes')
    .order('ts', { ascending: false }).limit(CHANGE_LIMIT)
  if (!showAllActors && superIds.length) {
    sessQuery   = sessQuery.in('user_id', superIds)
    footQuery   = footQuery.in('actor_user_id', superIds)
    changeQuery = changeQuery.in('actor_user_id', superIds)
  }
  const [{ data: sessData }, { data: footData }, { data: changeData }] = await Promise.all([
    sessQuery, footQuery, changeQuery,
  ])
  const sessions = (sessData ?? []) as unknown as SessionRow[]
  const footage  = (footData ?? []) as unknown as FootageRow[]
  const changeRows = (changeData ?? []) as unknown as ChangeRow[]

  // 操作者メール・テナント名・店舗名・カメラ名を解決（全テナント横断表示のため
  // 店舗は「テナント名／店舗名」で示す）。
  const userIds = [...new Set([
    ...sessions.map((s) => s.user_id),
    ...footage.map((f) => f.actor_user_id),
    ...changeRows.map((c) => c.actor_user_id),
  ].filter((v): v is string => !!v))]
  const storeIds = [...new Set([
    ...sessions.map((s) => s.store_id),
    ...footage.map((f) => f.store_id),
    ...changeRows.map((c) => c.store_id),
  ].filter((v): v is string => !!v))]
  const cameraIds = [...new Set([
    ...sessions.map((s) => s.camera_id),
    ...footage.map((f) => f.camera_id),
  ].filter((v): v is string => !!v))]

  const [{ data: admins }, { data: strs }, { data: cams }, { data: tenants }] = await Promise.all([
    userIds.length   ? svc.from('admin_users').select('auth_user_id, email').in('auth_user_id', userIds)
                     : Promise.resolve({ data: [] as { auth_user_id: string; email: string | null }[] }),
    storeIds.length  ? svc.from('stores').select('id, name, tenant_id').in('id', storeIds)
                     : Promise.resolve({ data: [] as { id: string; name: string | null; tenant_id: string | null }[] }),
    cameraIds.length ? svc.from('recorder_cameras').select('id, name').in('id', cameraIds)
                     : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
    svc.from('tenants').select('id, name'),
  ])
  const emailBy  = new Map((admins ?? []).map((a) => [a.auth_user_id as string, (a.email as string | null) ?? '']))
  const tenantBy = new Map((tenants ?? []).map((tn) => [tn.id as string, (tn.name as string | null) ?? '']))
  const storeRowBy = new Map((strs ?? []).map((s) => [s.id as string, s]))
  const cameraBy = new Map((cams ?? []).map((c) => [c.id as string, (c.name as string | null) ?? '']))

  const email = (uid: string | null) => (uid && emailBy.get(uid)) || (uid ? uid.slice(0, 8) + '…' : '—')
  const storeLabel = (sid: string | null) => {
    if (!sid) return ''
    const s = storeRowBy.get(sid)
    if (!s) return sid.slice(0, 8) + '…'
    const tn = s.tenant_id ? tenantBy.get(s.tenant_id) : null
    return tn ? `${tn}／${s.name ?? ''}` : (s.name ?? '')
  }
  const camera = (cid: string | null) => (cid && cameraBy.get(cid)) || ''

  const accessRows: AccessRowVM[] = [
    ...sessions.map((s) => ({
      id: `s_${s.id}`,
      accessedAt: s.started_at,
      accessType: s.mode,
      storeName: storeLabel(s.store_id),
      actorEmail: email(s.user_id),
      cameraName: camera(s.camera_id),
      durationSec: s.duration_sec,
    })),
    ...footage.map((f) => ({
      id: `f_${f.id}`,
      accessedAt: f.accessed_at,
      accessType: f.access_type,
      storeName: storeLabel(f.store_id),
      actorEmail: email(f.actor_user_id),
      cameraName: camera(f.camera_id),
      durationSec: null,
    })),
  ].sort((a, b) => b.accessedAt.localeCompare(a.accessedAt))

  const scopeLabel = showAllActors ? '全操作者' : '運営（super_admin）のみ'

  return (
    <AdminShell pathname="/admin/ops-audit" section="admin">
      <PageHeader
        title="運営アクセスログ"
        crumb={[
          { href: '/admin', label: 'マスタ' },
          { href: '/admin/ops-audit', label: '運営アクセスログ' },
        ]}
      />

      <div className="space-y-6 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500 dark:text-gedink3">
            SaaS 運営者の行動履歴を全テナント横断で表示します（テナント側のアクセスログには運営の行は表示されません）。
            現在の表示範囲: <span className="font-bold text-slate-700 dark:text-gedink">{scopeLabel}</span>
          </p>
          <Link
            href={showAllActors ? '/admin/ops-audit' : '/admin/ops-audit?actor=all'}
            className="shrink-0 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-gedline dark:bg-gedbg2 dark:text-gedink"
          >
            {showAllActors ? '運営のみ表示に戻す' : '全操作者を表示（横断）'}
          </Link>
        </div>

        <section>
          <h2 className="mb-2 text-[13px] font-bold text-slate-900 dark:text-gedink">
            視聴（ライブ / 16分割 / VOD / 証跡静止画）　直近 {accessRows.length} 件
          </h2>
          <AccessLogTable rows={accessRows} />
        </section>

        <section>
          <h2 className="mb-2 text-[13px] font-bold text-slate-900 dark:text-gedink">
            操作・設定変更　直近 {changeRows.length} 件
          </h2>
          {changeRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-white py-10 text-center dark:border-gedline dark:bg-gedbg2">
              <p className="text-sm font-medium text-slate-600 dark:text-gedink2">操作履歴はまだありません</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-gedline dark:bg-gedbg2">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">日時</th>
                    <th className="px-3 py-2 text-left">操作者</th>
                    <th className="px-3 py-2 text-left">操作</th>
                    <th className="px-3 py-2 text-left">テナント／店舗</th>
                    <th className="px-3 py-2 text-left">変更内容</th>
                  </tr>
                </thead>
                <tbody>
                  {changeRows.map((row) => (
                    <tr key={row.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-slate-600">{fmtJST(row.ts)}</td>
                      <td className="px-3 py-2 text-slate-700">{email(row.actor_user_id)}</td>
                      <td className="px-3 py-2">
                        <span className="inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-600">
                          {row.action}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">{storeLabel(row.store_id) || '—'}</td>
                      <td className="px-3 py-2">
                        <pre className="max-w-md overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-600">
                          {row.changes ? JSON.stringify(row.changes, null, 1) : '—'}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </AdminShell>
  )
}
