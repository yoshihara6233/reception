import { notFound, redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { AdminDenied } from '@/components/admin/AdminDenied'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { resolveAdminContext } from '@/lib/tenant/acting'
import { getStoreOptionAvailability, type StoreOptionAvailability } from '@/lib/admin/tenant-quota'
import { StoreEditForm } from './store-edit-form'

export default async function StoreEdit(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  // 店舗の編集画面。一覧(/admin/stores)と同じく ADMIN_ROLES の持ち物だが、
  // ここは notFound()（＝店舗が無い）しか見ておらず、ロール判定が無かった。
  const guard = await requireAdmin()
  if (!guard.ok) {
    if (guard.status === 401) redirect('/login')
    return <AdminDenied pathname="/admin/stores" />
  }
  const supa = await createSupabaseServer()
  const { data: store } = await supa
    .from('stores')
    .select('id, name, address, area_code, latitude, longitude, is_active, timezone, tenant_id, opt_patrol, opt_alarm, opt_baggage')
    .eq('id', id)
    .single()
  if (!store) notFound()

  // オプション ON/OFF は super_admin / tenant_admin のみ操作可。availability は
  // 店舗のテナントについて算出（自店舗は ON 数から除外）。
  const ctx = await resolveAdminContext(supa)
  const canManageOptions = !!ctx.role && ['super_admin', 'tenant_admin'].includes(ctx.role)
  const tenantId = (store as { tenant_id: string | null }).tenant_id
  const optionsAvail: StoreOptionAvailability = tenantId
    ? await getStoreOptionAvailability(createSupabaseService(), tenantId, id)
    : {
        patrol:  { contracted: false, limit: null, onCount: 0 },
        alarm:   { contracted: false, limit: null, onCount: 0 },
        baggage: { contracted: false, limit: null, onCount: 0 },
      }

  return (
    <AdminShell pathname="/admin/stores" section="admin">
      <PageHeader
        title={`店舗編集: ${(store as { name: string }).name}`}
        crumb={[
          { href: '/admin',         label: 'マスタ' },
          { href: '/admin/stores',  label: '店舗' },
          { href: `/admin/stores/${id}`, label: (store as { name: string }).name },
        ]}
      />
      <div className="max-w-2xl space-y-4 px-5 py-5">
        <StoreEditForm
          id={id}
          initial={store as never as {
            name: string; address: string | null; area_code: string | null;
            latitude: number | null; longitude: number | null; is_active: boolean;
            timezone: string | null; opt_patrol: boolean; opt_alarm: boolean; opt_baggage: boolean;
          }}
          optionsAvail={optionsAvail}
          canManageOptions={canManageOptions}
        />
      </div>
    </AdminShell>
  )
}
