import { redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { AdminDenied } from '@/components/admin/AdminDenied'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { ReleasesClient } from './releases-client'

/**
 * nvmsd リリース台帳（OTA_SPEC §3）— super_admin 専用。
 *
 * G・VMS がビルド・署名したリリース（バイナリ + .sig）をここで登録し、
 * エッジ詳細の「目標版」で拠点ごとに配備する（検証拠点 → 全体の段階配備）。
 */
export default async function NvmsdReleasesPage() {
  const guard = await requireSuperAdmin()
  if (!guard.ok) { if (guard.status === 401) redirect('/login'); return <AdminDenied pathname="/admin/nvmsd-releases" /> }
  const t = await getT()

  const svc = createSupabaseService()
  const [{ data: releases }, { data: edges }] = await Promise.all([
    svc
      .from('nvmsd_releases')
      .select('id, version, pkg_format, pkg_arch, sha256, bytes, notes, created_at')
      .order('created_at', { ascending: false })
      .limit(100),
    // 配備状況: nvmsd アップリンクのエッジだけ（agent_version の接頭辞で見分ける）。
    svc
      .from('edge_devices')
      .select('id, name, agent_version, desired_agent_version, update_force, pkg_format, pkg_arch, stores ( name )')
      .like('agent_version', 'nvmsd/%')
      .order('name')
      .limit(500),
  ])

  return (
    <AdminShell pathname="/admin/nvmsd-releases" section="admin">
      <PageHeader
        title="nvmsd リリース"
        crumb={[{ href: '/admin', label: t.breadcrumb.admin }, { href: '/admin/nvmsd-releases', label: 'nvmsd リリース' }]}
      />
      <div className="p-5">
        <ReleasesClient
          releases={(releases ?? []) as never}
          edges={(edges ?? []) as never}
        />
      </div>
    </AdminShell>
  )
}
