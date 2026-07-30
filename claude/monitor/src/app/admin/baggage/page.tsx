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
import { resolveAdminContext } from '@/lib/tenant/acting'
import { TenantSettingsClient } from './TenantSettingsClient'
import { StoreListClient, type StoreRow } from './StoreListClient'

export default async function AdminBaggagePage() {
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

  // 対象テナント: tenant_admin は自テナント。super_admin は「操作中テナント」に固定
  // （ページ内のテナント選択は撤去＝選び間違いで他テナント設定を書き換える事故を防ぐ）。
  const svc = createSupabaseService()
  const ctx = await resolveAdminContext(supa)
  const tenantId = ctx.tenantId ?? undefined

  if (!tenantId) {
    return (
      <AdminShell pathname="/admin/baggage" section="admin">
        <PageHeader title="手荷物検査 設定" />
        <div className="p-5 text-sm text-slate-600 dark:text-gedink2">
          操作中テナントが未選択です。上部バーまたは「運営管理 → テナント」から操作するテナントを選択してください。
        </div>
      </AdminShell>
    )
  }

  const settings = await loadTenantSettings(svc, tenantId)

  // 店舗別（有効化・カメラ）: テナント配下の全店舗＋各店舗の設定・カメラをまとめて取得。
  const { data: stores } = await svc.from('stores').select('id, name').eq('tenant_id', tenantId).order('name')
  const storeList = (stores ?? []) as { id: string; name: string }[]
  const storeIds = storeList.map((s) => s.id)

  const [{ data: settingsRows }, { data: cams }] = await Promise.all([
    storeIds.length
      ? svc.from('inspection_settings').select('store_id, enabled, camera_ids').in('store_id', storeIds)
      : Promise.resolve({ data: [] }),
    svc.from('recorder_cameras')
      .select('id, name, channel, recorders!inner ( edge_devices!inner ( store_id ) )')
      .eq('enabled', true),
  ])
  const settingsByStore = new Map((((settingsRows ?? []) as { store_id: string; enabled: boolean; camera_ids: string[] }[]))
    .map((s) => [s.store_id, s]))
  const camsByStore = new Map<string, { id: string; name: string; channel: number }[]>()
  for (const c of (cams ?? []) as { id: string; name: string; channel: number; recorders: unknown }[]) {
    const rec = Array.isArray(c.recorders) ? c.recorders[0] : c.recorders
    const ed = rec && (Array.isArray((rec as { edge_devices?: unknown }).edge_devices)
      ? (rec as { edge_devices: { store_id?: string }[] }).edge_devices[0]
      : (rec as { edge_devices?: { store_id?: string } }).edge_devices)
    const sid = (ed as { store_id?: string } | undefined)?.store_id
    if (!sid || !storeIds.includes(sid)) continue
    camsByStore.set(sid, [...(camsByStore.get(sid) ?? []), { id: c.id, name: c.name, channel: c.channel }])
  }

  const storeRows: StoreRow[] = storeList.map((s) => {
    const cameras = (camsByStore.get(s.id) ?? []).sort((a, b) => a.channel - b.channel)
    const cfg = settingsByStore.get(s.id)
    return {
      id: s.id,
      name: s.name,
      enabled: cfg?.enabled ?? false,
      cameraIds: ((cfg?.camera_ids ?? []) as string[]).filter((id) => cameras.some((c) => c.id === id)),
      cameras,
    }
  })

  return (
    <AdminShell pathname="/admin/baggage" section="admin">
      <PageHeader title="手荷物検査 設定" />
      <div className="space-y-8 p-5">
        <section>
          <h2 className="mb-3 text-[15px] font-bold text-slate-900 dark:text-gedink">共通設定（全店舗）</h2>
          {/* テナント選択は「操作中テナント」バーに一本化（ページ内selectは撤去＝tenants=[]） */}
          <TenantSettingsClient
            isSuperAdmin={role === 'super_admin'}
            tenants={[]}
            tenantId={tenantId}
            initial={settings}
          />
        </section>
        <section>
          <h2 className="mb-3 text-[15px] font-bold text-slate-900 dark:text-gedink">店舗別設定（有効化・検査台カメラ）</h2>
          <StoreListClient stores={storeRows} />
        </section>
      </div>
    </AdminShell>
  )
}
