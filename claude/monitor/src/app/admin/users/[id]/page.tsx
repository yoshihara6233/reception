import { notFound, redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { UserForm, type Role, type TenantOpt, type StoreOpt } from '../user-form'

export default async function EditUserPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
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

  // Load target with the service client: the self-only RLS SELECT policy
  // (auth_user_id = auth.uid()) would hide any user other than the caller.
  // Authorization is enforced by the role check above + the tenant scope below.
  const { data: target } = await createSupabaseService()
    .from('admin_users')
    .select('id, email, display_name, role, tenant_id, store_ids')
    .eq('id', id)
    .single()
  if (!target) notFound()

  // tenant_admin: only same-tenant
  if (me.role === 'tenant_admin' && target.tenant_id !== me.tenant_id) {
    notFound()
  }

  const [{ data: tenants }, { data: stores }] = await Promise.all([
    supa.from('tenants').select('id, name').order('name'),
    supa.from('stores').select('id, name, tenant_id').order('name'),
  ])

  return (
    <AdminShell pathname="/admin/users" section="admin">
      <PageHeader
        title={`ユーザー編集: ${(target as { display_name: string | null }).display_name ?? (target as { email: string }).email}`}
        crumb={[
          { href: '/admin',       label: 'マスタ' },
          { href: '/admin/users', label: 'ユーザー' },
          { href: `/admin/users/${id}`, label: '編集' },
        ]}
      />
      <div className="max-w-2xl space-y-4 px-5 py-5">
        <UserForm
          mode="edit"
          id={id}
          initial={{
            email:        (target as { email: string }).email,
            display_name: (target as { display_name: string | null }).display_name ?? '',
            role:         (target as { role: Role }).role,
            tenant_id:    (target as { tenant_id: string | null }).tenant_id,
            store_ids:    (target as { store_ids: string[] }).store_ids ?? [],
          }}
          tenants={(tenants ?? []) as TenantOpt[]}
          stores={(stores ?? []) as StoreOpt[]}
          canCreateSuperAdmin={me.role === 'super_admin'}
        />
      </div>
    </AdminShell>
  )
}
