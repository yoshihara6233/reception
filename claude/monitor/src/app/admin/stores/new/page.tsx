import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { resolveAdminContext } from '@/lib/tenant/acting'
import { getStoreOptionAvailability } from '@/lib/admin/tenant-quota'
import { StoreNewForm } from '../store-new-form'

export default async function NewStorePage() {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  // 店舗作成は super_admin / tenant_admin のみ。
  const ctx = await resolveAdminContext(supa)
  if (!ctx.role || !['super_admin', 'tenant_admin'].includes(ctx.role)) notFound()

  // 作成先テナントは文脈から自動決定（drop-down は置かない）。
  // super_admin は「操作中テナント」を選んでからでないと作成できない。
  if (!ctx.tenantId) {
    return (
      <AdminShell pathname="/admin/stores" section="admin">
        <PageHeader
          title="店舗 新規作成"
          crumb={[
            { href: '/admin',        label: 'マスタ' },
            { href: '/admin/stores', label: '店舗' },
            { href: '/admin/stores/new', label: '新規作成' },
          ]}
        />
        <div className="max-w-2xl space-y-3 px-5 py-5 text-sm text-slate-600">
          <p>操作中テナントが未選択のため、店舗を作成できません。</p>
          <p>
            <Link href="/admin/tenants" className="text-blue-600 underline">
              運営管理 → テナント
            </Link>
            から操作するテナントを選択してください。
          </p>
        </div>
      </AdminShell>
    )
  }

  return (
    <AdminShell pathname="/admin/stores" section="admin">
      <PageHeader
        title="店舗 新規作成"
        crumb={[
          { href: '/admin',         label: 'マスタ' },
          { href: '/admin/stores',  label: '店舗' },
          { href: '/admin/stores/new', label: '新規作成' },
        ]}
      />
      <div className="max-w-2xl px-5 py-5">
        <StoreNewForm
          lockedTenantId={ctx.tenantId}
          tenantName={ctx.tenantName}
          optionsAvail={await getStoreOptionAvailability(createSupabaseService(), ctx.tenantId)}
        />
      </div>
    </AdminShell>
  )
}
