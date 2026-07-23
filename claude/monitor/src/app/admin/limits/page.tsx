/**
 * /admin/limits — 視聴上限（セッション時間上限・同時視聴上限）のテナント別設定（R1）。
 *
 * super_admin=全テナント / tenant_admin=自テナントのみ。session_limits は self-only ではなく
 * modify=admin ロールの RLS だが、tenants 一覧は service client で解決（他ロールの越権は
 * requireAdmin ＋ role フィルタで防ぐ）。
 */
import { notFound } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { getT } from '@/lib/i18n/server'
import { LimitsEditor, type LimitRowVM } from './LimitsEditor'

const DEFAULT_MAX_SESSION_MIN = 120
const DEFAULT_MAX_CONCURRENT = 5

export default async function LimitsAdmin() {
  const t = await getT()

  // ②運営管理＝super_admin 専用（視聴上限は運営/契約側の制御）。
  const guard = await requireAdmin()
  if (!guard.ok || guard.profile.role !== 'super_admin') {
    notFound()
  }
  const isSuper = true

  const svc = createSupabaseService()
  let tq = svc.from('tenants').select('id, name').order('name').limit(500)
  if (!isSuper) tq = tq.eq('id', guard.profile.tenant_id)
  const { data: tenants } = await tq
  const tlist = (tenants ?? []) as { id: string; name: string }[]

  const ids = tlist.map((tn) => tn.id)
  const { data: limits } = ids.length
    ? await svc.from('session_limits').select('tenant_id, max_concurrent, max_session_min').in('tenant_id', ids)
    : { data: [] as { tenant_id: string; max_concurrent: number; max_session_min: number }[] }
  const limBy = new Map(
    (limits ?? []).map((l) => [l.tenant_id as string, l as { max_concurrent: number; max_session_min: number }]),
  )

  const rows: LimitRowVM[] = tlist.map((tn) => {
    const lim = limBy.get(tn.id)
    return {
      tenantId:      tn.id,
      name:          tn.name,
      maxSessionMin: lim?.max_session_min ?? DEFAULT_MAX_SESSION_MIN,
      maxConcurrent: lim?.max_concurrent ?? DEFAULT_MAX_CONCURRENT,
      hasRow:        !!lim,
    }
  })

  return (
    <AdminShell pathname="/admin/limits" section="admin">
      <PageHeader
        title={t.adminNav.limits}
        crumb={[
          { href: '/admin', label: t.breadcrumb.admin },
          { href: '/admin/limits', label: t.adminNav.limits },
        ]}
      />
      <LimitsEditor rows={rows} />
    </AdminShell>
  )
}
