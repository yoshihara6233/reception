import { notFound, redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { createSupabaseServer } from '@/lib/supabase/server'
import { UserForm, type Role, type TenantOpt, type StoreOpt } from '../user-form'

export default async function NewUserPage() {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supa
    .from('admin_users')
    .select('role, tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!me || (me.role !== 'super_admin' && me.role !== 'tenant_admin')) {
    notFound()
  }

  // Fetch tenants + stores for picker
  const [{ data: tenants }, { data: stores }] = await Promise.all([
    supa.from('tenants').select('id, name').order('name'),
    supa.from('stores').select('id, name, tenant_id').order('name'),
  ])

  // tenant_admin: pre-fill tenant
  const initialTenantId = me.role === 'tenant_admin' ? me.tenant_id : null
  const initialRole: Role = me.role === 'tenant_admin' ? 'store_manager' : 'viewer'

  return (
    <AdminShell pathname="/admin/users" section="admin">
      <PageHeader
        title="ユーザー新規作成"
        crumb={[
          { href: '/admin',       label: 'マスタ' },
          { href: '/admin/users', label: 'ユーザー' },
          { href: '/admin/users/new', label: '新規作成' },
        ]}
      />
      <div className="max-w-2xl space-y-4 px-5 py-5">
        <UserForm
          mode="create"
          initial={{
            email:        '',
            display_name: '',
            role:         initialRole,
            tenant_id:    initialTenantId,
            store_ids:    [],
          }}
          tenants={(tenants ?? []) as TenantOpt[]}
          stores={(stores ?? []) as StoreOpt[]}
          canCreateSuperAdmin={me.role === 'super_admin'}
        />
      </div>
    </AdminShell>
  )
}
