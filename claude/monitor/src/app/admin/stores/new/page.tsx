import { notFound, redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { StoreNewForm, type TenantOpt } from '../store-new-form'

export default async function NewStorePage() {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supa
    .from('admin_users').select('role, tenant_id').eq('auth_user_id', user.id).single()
  // 店舗作成は super_admin / tenant_admin のみ。
  if (!me || (me.role !== 'super_admin' && me.role !== 'tenant_admin')) notFound()

  // super_admin は全テナントから選択。tenant_admin は自テナント固定（picker 不要）。
  let tenants: TenantOpt[] = []
  if (me.role === 'super_admin') {
    const svc = createSupabaseService()
    const { data } = await svc.from('tenants').select('id, name').order('name')
    tenants = (data ?? []) as TenantOpt[]
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
          tenants={tenants}
          lockedTenantId={me.role === 'tenant_admin' ? me.tenant_id : null}
        />
      </div>
    </AdminShell>
  )
}
