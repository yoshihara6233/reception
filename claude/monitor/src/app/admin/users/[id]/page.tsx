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

  // ①設定プレーンはテナント配下のユーザーだけを扱う。super_admin は
  // ②運営管理 → /admin/ops-users/[id] へ分けた（面を混ぜない）。
  if ((target as { role: string }).role === 'super_admin') notFound()

  // tenant_admin: only same-tenant
  if (me.role === 'tenant_admin' && target.tenant_id !== me.tenant_id) {
    notFound()
  }

  // テナント分離: 店舗ピッカーは編集対象ユーザーのテナントに限定
  // （store_ids はそのテナント店舗に属す必要があり、他テナント店舗名の送信も防ぐ）。
  let storesQuery = supa.from('stores').select('id, name, tenant_id').order('name')
  if (target.tenant_id) storesQuery = storesQuery.eq('tenant_id', target.tenant_id)
  const [{ data: tenants }, { data: stores }] = await Promise.all([
    supa.from('tenants').select('id, name').order('name'),
    storesQuery,
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
