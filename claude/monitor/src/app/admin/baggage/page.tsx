/**
 * /admin/baggage — 手荷物検査 共通設定（テナント単位・全店舗共通）
 *
 * 保持日数・NVR保持・STEP無操作タイムアウト・端末モード・音声・検査STEP文言を
 * テナント共通で編集する。super_admin / tenant_admin のみ。
 */
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { loadTenantSettings } from '@/lib/baggage/tenant-settings'
import { TenantSettingsClient } from './TenantSettingsClient'

export default async function AdminBaggagePage(
  { searchParams }: { searchParams: Promise<{ tenant?: string }> },
) {
  const sp = await searchParams
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supa
    .from('admin_users')
    .select('role, tenant_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  const role = profile?.role as string | undefined
  if (role !== 'super_admin' && role !== 'tenant_admin') {
    return (
      <AdminShell pathname="/admin/baggage" section="admin">
        <PageHeader title="手荷物検査 共通設定" />
        <div className="p-5 text-sm text-slate-600 dark:text-gedink2">この設定を変更する権限がありません。</div>
      </AdminShell>
    )
  }

  // 対象テナント: tenant_admin は自テナント。super_admin はテナント選択可（既定は自分/先頭）。
  const svc = createSupabaseService()
  let tenants: { id: string; name: string }[] = []
  let tenantId = profile?.tenant_id as string | undefined
  if (role === 'super_admin') {
    const { data } = await svc.from('tenants').select('id, name').order('name')
    tenants = (data ?? []) as { id: string; name: string }[]
    tenantId = (sp.tenant && tenants.some((t) => t.id === sp.tenant)) ? sp.tenant : (tenantId ?? tenants[0]?.id)
  }

  if (!tenantId) {
    return (
      <AdminShell pathname="/admin/baggage" section="admin">
        <PageHeader title="手荷物検査 共通設定" />
        <div className="p-5 text-sm text-slate-600 dark:text-gedink2">対象テナントを解決できませんでした。</div>
      </AdminShell>
    )
  }

  const settings = await loadTenantSettings(svc, tenantId)

  return (
    <AdminShell pathname="/admin/baggage" section="admin">
      <PageHeader title="手荷物検査 共通設定" />
      <div className="p-5">
        <TenantSettingsClient
          isSuperAdmin={role === 'super_admin'}
          tenants={tenants}
          tenantId={tenantId}
          initial={settings}
        />
      </div>
    </AdminShell>
  )
}
