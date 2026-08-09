/**
 * /admin/audit — 映像アクセスログ（統合）
 *
 * ライブ/16分割/VOD の閲覧セッション（live_sessions）と 証跡静止画アクセス
 * （footage_access_log）を1つの表に統合。種別列・列絞込・CSV は AccessLogTable(client)。
 * RLS: live_sessions=自分+tenant/super_admin全件 / footage=admin ロールのみ。
 */
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { resolveAdminContext } from '@/lib/tenant/acting'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { AdminDenied } from '@/components/admin/AdminDenied'
import { requireAdmin } from '@/lib/admin/guard'
import { AccessLogTable, type AccessRowVM } from './AccessLogTable'
import { getT } from '@/lib/i18n/server'

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

const LIMIT = 500

export default async function AuditPage() {
  const supa = await createSupabaseServer()
  const t = await getT()
  const ta = t.adminAudit

  // アクセスログは運用の記録＝ADMIN_ROLES の持ち物。閲覧者(viewer)は
  // ログインさえしていれば読めていた（RLS でテナント内には絞られるが、
  // 「誰がいつ何を見たか」は閲覧専用ロールに渡すものではない）。
  const guard = await requireAdmin()
  if (!guard.ok) {
    if (guard.status === 401) redirect('/login')
    return <AdminDenied pathname="/admin/audit" />
  }

  // アクセスログは①設定プレーン＝操作中テナントに絞る（tenant_admin=自テナント /
  // super_admin=選択中テナント）。対象テナントの店舗IDでフィルタ。未選択の
  // super_admin のみ全件（従来どおり）。
  const ctx = await resolveAdminContext(supa)
  let scopeStoreIds: string[] | null = null
  if (ctx.storeIds) {
    // 店舗限定ロールは担当店舗のログのみ。
    scopeStoreIds = ctx.storeIds
  } else if (ctx.tenantId) {
    const svc0 = createSupabaseService()
    const { data: ts } = await svc0.from('stores').select('id').eq('tenant_id', ctx.tenantId)
    scopeStoreIds = (ts ?? []).map((s) => s.id as string)
  }

  // 2ソースを並行取得。※ live_sessions は store/camera への FK が無く PostgREST
  //   埋め込みJOINが失敗するため、店舗名・カメラ名は下の service client マップで解決。
  let sessQuery = supa.from('live_sessions')
    .select('id, user_id, store_id, camera_id, mode, started_at, duration_sec')
    .order('started_at', { ascending: false }).limit(LIMIT)
  let footQuery = supa.from('footage_access_log')
    .select('id, actor_user_id, store_id, camera_id, access_type, accessed_at')
    .order('accessed_at', { ascending: false }).limit(LIMIT)
  if (scopeStoreIds) {
    sessQuery = sessQuery.in('store_id', scopeStoreIds)
    footQuery = footQuery.in('store_id', scopeStoreIds)
  }
  const [{ data: sessData }, { data: footData }] = await Promise.all([sessQuery, footQuery])
  const sessions = (sessData ?? []) as unknown as SessionRow[]
  const footage  = (footData ?? []) as unknown as FootageRow[]

  // 操作者メール・店舗名・カメラ名を service client で解決（admin_users は self-only RLS の
  // ため要バイパス。表示対象行は上の RLS で既に限定済＝越権にはならない）。
  const svc = createSupabaseService()
  const userIds   = [...new Set([...sessions.map((s) => s.user_id), ...footage.map((f) => f.actor_user_id)].filter(Boolean))]
  const storeIds  = [...new Set([...sessions.map((s) => s.store_id), ...footage.map((f) => f.store_id)].filter((v): v is string => !!v))]
  const cameraIds = [...new Set([...sessions.map((s) => s.camera_id), ...footage.map((f) => f.camera_id)].filter((v): v is string => !!v))]
  const [{ data: admins }, { data: strs }, { data: cams }] = await Promise.all([
    userIds.length   ? svc.from('admin_users').select('auth_user_id, email, role').in('auth_user_id', userIds)
                     : Promise.resolve({ data: [] as { auth_user_id: string; email: string | null; role: string | null }[] }),
    storeIds.length  ? svc.from('stores').select('id, name').in('id', storeIds)
                     : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
    cameraIds.length ? svc.from('recorder_cameras').select('id, name').in('id', cameraIds)
                     : Promise.resolve({ data: [] as { id: string; name: string | null }[] }),
  ])
  const emailBy  = new Map((admins ?? []).map((a) => [a.auth_user_id as string, (a.email as string | null) ?? '']))
  const storeBy  = new Map((strs ?? []).map((s) => [s.id as string, (s.name as string | null) ?? '']))
  const cameraBy = new Map((cams ?? []).map((c) => [c.id as string, (c.name as string | null) ?? '']))

  // SaaS運営者（super_admin）の閲覧はテナント側に見せない: 記録は残すが、
  // 閲覧者が super_admin でない場合は super_admin 操作者の行を除外する。
  const superActorIds = new Set(
    (admins ?? []).filter((a) => a.role === 'super_admin').map((a) => a.auth_user_id as string),
  )
  const hideSuperActors = ctx.role !== 'super_admin'
  const visibleSessions = hideSuperActors ? sessions.filter((s) => !superActorIds.has(s.user_id)) : sessions
  const visibleFootage  = hideSuperActors ? footage.filter((f) => !superActorIds.has(f.actor_user_id)) : footage
  const email  = (uid: string) => emailBy.get(uid) || (uid ? uid.slice(0, 8) + '…' : '')
  const store  = (sid: string | null) => (sid && storeBy.get(sid)) || ''
  const camera = (cid: string | null) => (cid && cameraBy.get(cid)) || ''

  const rows: AccessRowVM[] = [
    ...visibleSessions.map((s) => ({
      id: `s_${s.id}`,
      accessedAt: s.started_at,
      accessType: s.mode,
      storeName: store(s.store_id),
      actorEmail: email(s.user_id),
      cameraName: camera(s.camera_id),
      durationSec: s.duration_sec,
    })),
    ...visibleFootage.map((f) => ({
      id: `f_${f.id}`,
      accessedAt: f.accessed_at,
      accessType: f.access_type,
      storeName: store(f.store_id),
      actorEmail: email(f.actor_user_id),
      cameraName: camera(f.camera_id),
      durationSec: null,
    })),
  ].sort((a, b) => b.accessedAt.localeCompare(a.accessedAt))

  return (
    <AdminShell pathname="/admin/audit" section="admin">
      <PageHeader
        title={ta.title}
        crumb={[
          { href: '/admin', label: t.breadcrumb.admin },
          { href: '/admin/audit', label: ta.title },
        ]}
      />

      <div className="px-5 py-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-slate-500 dark:text-gedink3">
            ライブ/16分割/VOD の閲覧と、証跡静止画（発報・巡回・BCP）の閲覧を1つに記録。種別・店舗・操作者・カメラで絞込・CSV書出し可。
          </p>
          <Link href="/admin/audit/changes" className="shrink-0 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-gedline dark:bg-gedbg2 dark:text-gedink">
            設定変更ログ →
          </Link>
        </div>

        <AccessLogTable rows={rows} />
      </div>
    </AdminShell>
  )
}
