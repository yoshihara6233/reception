import { redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { AdminDenied } from '@/components/admin/AdminDenied'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { hasCapability } from '@/lib/edge/capabilities'
import { CAP_OS_UPDATE } from '@/lib/admin/os-update-files'
import { OsUpdatesClient, type OsUpdateEdgeRow, type OsUpdateFileRow } from './os-updates-client'

export const dynamic = 'force-dynamic'

/**
 * OS 更新ファイル（接続仕様 §14・E-4-8）— super_admin 専用。
 *
 * 当社が署名した OS 更新ファイルを登録し、届ける拠点を選ぶ。拠点は 10 分以内に受け取り、
 * 画面の「OS の更新」に出す。**届いても当たらない**（始めるのは拠点の管理者）。
 */
export default async function OsUpdatesPage() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) { if (guard.status === 401) redirect('/login'); return <AdminDenied pathname="/admin/os-updates" /> }
  const t = await getT()

  const svc = createSupabaseService()
  const [files, edges] = await Promise.all([
    svc
      .from('os_update_files')
      .select('id, file_id, title, advisory, cve, issued_at, packages, reboot, notes, created_at, withdrawn_at')
      .order('created_at', { ascending: false })
      .limit(200),
    svc
      .from('edge_devices')
      .select('id, name, agent_version, capabilities, os_vuln_urgent, os_vuln_routine, os_update_file_id, stores ( name, tenants ( name ) )')
      .like('agent_version', 'nvmsd/%')
      .order('name')
      .limit(2000),
  ])
  // migration の前（表・列が無い）は、画面を落とさずにその旨を出す
  const notReady = !!files.error || !!edges.error

  type RawEdge = {
    id: string; name: string; agent_version: string | null; capabilities: string[] | null
    os_vuln_urgent: number | null; os_vuln_routine: number | null; os_update_file_id: string | null
    stores: { name: string; tenants: { name: string } | null } | null
  }
  const edgeRows: OsUpdateEdgeRow[] = ((edges.data ?? []) as unknown as RawEdge[]).map((e) => ({
    id: e.id,
    name: e.name,
    store: e.stores?.name ?? null,
    tenant: e.stores?.tenants?.name ?? null,
    version: (e.agent_version ?? '').replace(/^nvmsd\//, ''),
    capable: hasCapability(e, CAP_OS_UPDATE),
    urgent: e.os_vuln_urgent ?? 0,
    routine: e.os_vuln_routine ?? 0,
    fileId: e.os_update_file_id,
  }))

  return (
    <AdminShell pathname="/admin/os-updates" section="admin">
      <PageHeader
        title="OS 更新ファイル"
        crumb={[{ href: '/admin', label: t.breadcrumb.admin }, { href: '/admin/os-updates', label: 'OS 更新ファイル' }]}
      />
      <div className="p-5">
        {notReady ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            この機能の表がまだデータベースにありません。migration（20261127090000_os_update_files）を適用すると使えます。
          </p>
        ) : (
          <OsUpdatesClient files={(files.data ?? []) as OsUpdateFileRow[]} edges={edgeRows} />
        )}
      </div>
    </AdminShell>
  )
}
