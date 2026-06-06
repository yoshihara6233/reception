/**
 * /infra/settings — 監視設定（店舗別）
 *
 * 店舗ごとに監視の有効化・エッジ無応答閾値・チェック間隔・デバウンス閾値・通知先・
 * メンテ窓を設定。テナントスコープは RLS で自動適用。
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { MonitorSettingsCard, type StoreSetting } from './SettingsForm'
import { getT } from '@/lib/i18n/server'

interface StoreRow { id: string; name: string; area_code: string | null }
interface SettingRow {
  store_id: string
  enabled: boolean
  edge_offline_threshold_min: number
  check_interval_min: number
  fail_threshold: number
  ok_threshold: number
  notify_emails: string[] | null
  maintenance_until: string | null
}

export default async function InfraSettingsPage() {
  const supa = await createSupabaseServer()
  const t = await getT()
  const ts = t.infraSettings

  const [storesRes, settingsRes] = await Promise.all([
    supa.from('stores').select('id, name, area_code').order('area_code', { ascending: true, nullsFirst: false }).order('name').limit(10_000),
    supa.from('monitor_settings').select('store_id, enabled, edge_offline_threshold_min, check_interval_min, fail_threshold, ok_threshold, notify_emails, maintenance_until').limit(10_000),
  ])

  const stores = (storesRes.data ?? []) as StoreRow[]
  const byStore = new Map(((settingsRes.data ?? []) as SettingRow[]).map((s) => [s.store_id, s]))

  const rows: StoreSetting[] = stores.map((st) => {
    const c = byStore.get(st.id)
    return {
      storeId: st.id,
      storeName: st.name,
      enabled: c?.enabled ?? false,
      edgeOfflineThresholdMin: c?.edge_offline_threshold_min ?? 5,
      checkIntervalMin: c?.check_interval_min ?? 5,
      failThreshold: c?.fail_threshold ?? 3,
      okThreshold: c?.ok_threshold ?? 2,
      notifyEmails: c?.notify_emails ?? [],
      maintenanceUntil: c?.maintenance_until ?? null,
    }
  })

  return (
    <AdminShell pathname="/infra/settings" section="infra">
      <PageHeader title={ts.title} crumb={[{ href: '/infra', label: t.breadcrumb.infra }, { href: '/infra/settings', label: ts.title }]} />
      <div className="px-5 py-4 space-y-3">
        {rows.map((r) => <MonitorSettingsCard key={r.storeId} row={r} />)}
        {rows.length === 0 && (
          <p className="text-xs text-slate-500 dark:text-gedink3">{ts.empty}</p>
        )}
        <p className="text-[11px] text-slate-400 dark:text-gedink3">
          {ts.intro}
        </p>
      </div>
    </AdminShell>
  )
}
