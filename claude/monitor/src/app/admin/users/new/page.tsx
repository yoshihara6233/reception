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
  // super_admin が操作中テナントを選択している間は、そのテナントに固定。
  const acting = me.role === 'super_admin' && ctx.acting

  // Fetch tenants + stores for picker。
  // テナント分離: 操作中(acting)の間は店舗ピッカーも操作中テナントに絞る
  // （従来は全テナントの店舗名・IDをクライアントへ送っていた＝他テナント漏洩）。
  let storesQuery = supa.from('stores').select('id, name, tenant_id').order('name')
  if (acting && ctx.tenantId) storesQuery = storesQuery.eq('tenant_id', ctx.tenantId)
  const [{ data: tenantsAll }, { data: stores }] = await Promise.all([
    supa.from('tenants').select('id, name').order('name'),
    storesQuery,
  ])

  // picker には対象テナントのみ表示（super_admin ロールの作成は不可）。
  // 未選択の super_admin は従来どおり全テナント選択可（運営としての作成）。
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
          // ①設定プレーンでは super_admin を作らせない。運営者の作成は
          // ②運営管理 → /admin/ops-users/new で行う。
          canCreateSuperAdmin={false}
        />
      </div>
    </AdminShell>
  )
}
