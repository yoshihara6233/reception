/**
 * /security/settings — 店舗別 巡回設定
 *
 * 店舗ごとに巡回間隔・AI有効化・日次上限・通知先・有効化を編集。
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { SettingsCard, type StoreSetting } from './SettingsForm'
import { getT } from '@/lib/i18n/server'

interface StoreRow {
  id: string
  name: string
  area_code: string | null
}

interface SettingRow {
  store_id: string
  schedule_mode: string
  patrol_interval_min: number
  active_from: string
  active_to: string
  active_days: number[] | null
  patrol_times: string[] | null
  notify_emails: string[] | null
  report_show_verification: boolean
  enabled: boolean
}

export default async function SecuritySettingsPage() {
  const supa = await createSupabaseServer()
  const t = await getT()
  const ts = t.securitySettings

  const [storesRes, settingsRes] = await Promise.all([
    supa.from('stores').select('id, name, area_code').order('area_code', { ascending: true, nullsFirst: false }).order('name').limit(10_000),
    supa.from('security_settings').select('store_id, schedule_mode, patrol_interval_min, active_from, active_to, active_days, patrol_times, notify_emails, report_show_verification, enabled').limit(10_000),
  ])

  const stores = (storesRes.data ?? []) as StoreRow[]
  const settings = (settingsRes.data ?? []) as SettingRow[]
  const byStore = new Map(settings.map((s) => [s.store_id, s]))

  const rows: StoreSetting[] = stores.map((st) => {
    const cfg = byStore.get(st.id)
    return {
      storeId: st.id,
      storeName: st.name,
      areaCode: st.area_code,
      scheduleMode: (cfg?.schedule_mode === 'fixed' ? 'fixed' : 'interval'),
      patrolIntervalMin: cfg?.patrol_interval_min ?? 240,
      activeFrom: cfg?.active_from ?? '00:00',
      activeTo: cfg?.active_to ?? '24:00',
      activeDays: cfg?.active_days ?? [0, 1, 2, 3, 4, 5, 6],
      patrolTimes: cfg?.patrol_times ?? [],
      notifyEmails: cfg?.notify_emails ?? [],
      reportShowVerification: cfg?.report_show_verification ?? true,
      enabled: cfg?.enabled ?? false,
    }
  })

  return (
    <AdminShell pathname="/security/settings" section="security">
      <PageHeader
        title={ts.title}
        crumb={[{ href: '/security', label: t.breadcrumb.security }, { href: '/security/settings', label: ts.title }]}
      />
      <div className="px-5 py-4 space-y-3">
        {rows.map((r) => (
          <SettingsCard key={r.storeId} row={r} />
        ))}
        {rows.length === 0 && (
          <p className="text-xs text-slate-500 dark:text-gedink3">{ts.empty}</p>
        )}
      </div>
    </AdminShell>
  )
}
