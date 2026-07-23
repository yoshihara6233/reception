import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { TenantForm, type Plan, type Status } from '../tenant-form'

export default async function EditTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  const { data: me } = await supa
    .from('admin_users').select('role').eq('auth_user_id', user.id).single()
  if (me?.role !== 'super_admin') notFound()

  const svc = createSupabaseService()
  const { data: tenant } = await svc
    .from('tenants')
    .select('id, name, plan, status, slug, opt_patrol, opt_alarm, opt_baggage, stores(count)')
    .eq('id', id)
    .single()
  if (!tenant) notFound()

  const storeCount = (tenant.stores as { count: number }[] | null)?.[0]?.count ?? 0

  return (
    <AdminShell pathname="/admin/tenants" section="admin">
      <PageHeader
        title={`テナント編集 — ${tenant.name}`}
        crumb={[
          { href: '/admin',         label: 'マスタ' },
          { href: '/admin/tenants', label: 'テナント' },
          { href: `/admin/tenants/${id}`, label: '編集' },
        ]}
      />
      <div className="max-w-2xl space-y-4 px-5 py-5">
        <div className="flex items-center gap-6 rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">店舗数</div>
            <div className="text-lg font-bold tabular-nums">{storeCount.toLocaleString()} 件</div>
          </div>
          <Link href="/admin/stores/new" className="text-blue-600 hover:underline">＋ 店舗を追加</Link>
        </div>

        <TenantForm
          mode="edit"
          id={id}
          initial={{
            name:        tenant.name,
            plan:        tenant.plan as Plan,
            status:      tenant.status as Status,
            slug:        tenant.slug,
            opt_patrol:  !!tenant.opt_patrol,
            opt_alarm:   !!tenant.opt_alarm,
            opt_baggage: !!tenant.opt_baggage,
          }}
        />
      </div>
    </AdminShell>
  )
}
