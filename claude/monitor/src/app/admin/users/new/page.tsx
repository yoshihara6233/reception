import { notFound, redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { createSupabaseServer } from '@/lib/supabase/server'
import { resolveAdminContext } from '@/lib/tenant/acting'
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

  // テナント文脈（super_admin=操作中テナント / tenant_admin=自テナント）。
  const ctx = await resolveAdminContext(supa)

  // Fetch tenants + stores for picker
  const [{ data: tenantsAll }, { data: stores }] = await Promise.all([
    supa.from('tenants').select('id, name').order('name'),
    supa.from('stores').select('id, name, tenant_id').order('name'),
  ])

  // super_admin が操作中テナントを選択している間は、そのテナントに固定して
  // 作成する（picker には対象テナントのみ表示・super_admin ロールの作成は不可）。
  // 未選択の super_admin は従来どおり全テナント選択可（運営としての作成）。
  const acting = me.role === 'super_admin' && ctx.acting
  const tenants = acting
    ? ((tenantsAll ?? []) as TenantOpt[]).filter((t) => t.id === ctx.tenantId)
    : ((tenantsAll ?? []) as TenantOpt[])

  const initialTenantId =
    me.role === 'tenant_admin' ? me.tenant_id
    : acting                   ? ctx.tenantId
    : null
  const initialRole: Role = me.role === 'tenant_admin' || acting ? 'store_manager' : 'viewer'

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
          tenants={tenants}
          stores={(stores ?? []) as StoreOpt[]}
          canCreateSuperAdmin={me.role === 'super_admin' && !acting}
        />
      </div>
    </AdminShell>
  )
}
