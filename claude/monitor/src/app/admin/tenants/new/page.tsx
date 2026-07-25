import { notFound, redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { createSupabaseServer } from '@/lib/supabase/server'
import { TenantForm } from '../tenant-form'

export default async function NewTenantPage() {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supa
    .from('admin_users').select('role').eq('auth_user_id', user.id).single()
  if (me?.role !== 'super_admin') notFound()

  return (
    <AdminShell pathname="/admin/tenants" section="admin">
      <PageHeader
        title="テナント新規作成"
        crumb={[
          { href: '/admin',          label: 'マスタ' },
          { href: '/admin/tenants',  label: 'テナント' },
          { href: '/admin/tenants/new', label: '新規作成' },
        ]}
      />
      <div className="max-w-2xl px-5 py-5">
        <TenantForm
          mode="create"
          initial={{
            name: '', plan: 'starter', status: 'trial', slug: null,
            opt_patrol: false, opt_alarm: false, opt_baggage: false,
            max_stores: null, max_patrol: null, max_alarm: null, max_baggage: null,
          }}
        />
      </div>
    </AdminShell>
  )
}
