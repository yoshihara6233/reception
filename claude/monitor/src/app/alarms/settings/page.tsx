/**
 * /security/alarms/settings — 発報設定（店舗別）
 *
 * 有効/無効・通知先・静音時間・Webhook を店舗毎に設定。購読源/種別/デバウンスは
 * エッジ ONVIF Event 購読（PB5）導入時に拡張する。
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell, ALARM_NAV } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { AlarmSettingsTable, type AlarmSetting } from './AlarmSettingsTable'

interface StoreRow { id: string; name: string; area_code: string | null }
interface SettingRow {
  store_id: string
  enabled: boolean
  notify_emails: string[] | null
  quiet_from: string | null
  quiet_to: string | null
  notify_webhook_url: string | null
}

export default async function AlarmSettingsPage() {
  const supa = await createSupabaseServer()

  const [storesRes, settingsRes] = await Promise.all([
    supa.from('stores').select('id, name, area_code').eq('is_active', true)
      .order('area_code', { ascending: true, nullsFirst: false }).order('name').limit(10_000),
    supa.from('alarm_settings').select('store_id, enabled, notify_emails, quiet_from, quiet_to, notify_webhook_url').limit(10_000),
  ])

  const stores = (storesRes.data ?? []) as StoreRow[]
  const byStore = new Map(((settingsRes.data ?? []) as SettingRow[]).map((s) => [s.store_id, s]))

  const rows: AlarmSetting[] = stores.map((st) => {
    const cfg = byStore.get(st.id)
    return {
      storeId: st.id,
      storeName: st.name,
      areaCode: st.area_code,
      enabled: cfg?.enabled ?? false,
      notifyEmails: cfg?.notify_emails ?? [],
      quietFrom: cfg?.quiet_from ?? null,
      quietTo: cfg?.quiet_to ?? null,
      notifyWebhookUrl: cfg?.notify_webhook_url ?? null,
    }
  })

  return (
    <AdminShell pathname="/alarms/settings" nav={ALARM_NAV} navTitle="ALARM">
      <PageHeader
        title="発報設定"
        crumb={[
          { href: '/alarms', label: 'ALARM' },
          { href: '/alarms/settings', label: '発報設定' },
        ]}
      />
      <div className="space-y-3 px-5 py-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-relaxed text-blue-800/90 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200/80">
          店舗ごとに発報の<b>通知先</b>・<b>静音時間</b>・<b>Webhook</b> を設定します。<b>有効</b>の店舗のみ通知します
          （発報自体は常に記録）。緊急対処・駆けつけは提供せず、<b>記録・通知の導線</b>のみです。
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-gedink3">店舗がありません。</p>
        ) : (
          <AlarmSettingsTable initialRows={rows} />
        )}
      </div>
    </AdminShell>
  )
}
