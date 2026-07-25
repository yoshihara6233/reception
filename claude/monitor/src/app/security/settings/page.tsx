/**
 * /security/settings — 巡回設定（店舗別・一覧＋一括変更）
 *
 * 固定時刻モード: 1日最大4回の巡回時刻を店舗毎に指定（全曜日実施・曜日指定なし）。
 * /admin/bcp と同形の一覧UI（絞り込み・複数選択・一括設定）。
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { SecuritySettingsTable, type SecuritySetting } from './SecuritySettingsTable'
import { getT } from '@/lib/i18n/server'
import { resolveMonitorScope } from '@/lib/tenant/monitor-scope'
import { TenantGate } from '@/components/TenantGate'

interface StoreRow { id: string; name: string; area_code: string | null }
interface SettingRow {
  store_id: string
  enabled: boolean
  patrol_times: string[] | null
  notify_emails: string[] | null
}

export default async function SecuritySettingsPage() {
  const supa = await createSupabaseServer()
  const t = await getT()
  const ts = t.securitySettings

  const scope = await resolveMonitorScope(supa)
  if (scope.needsTenant) {
    return (
      <AdminShell pathname="/security/settings" section="security">
        <TenantGate />
      </AdminShell>
    )
  }

  const [storesRes, settingsRes] = await Promise.all([
    supa.from('stores').select('id, name, area_code').eq('is_active', true).in('id', scope.storeIds)
      .order('area_code', { ascending: true, nullsFirst: false }).order('name').limit(10_000),
    supa.from('security_settings').select('store_id, enabled, patrol_times, notify_emails').in('store_id', scope.storeIds).limit(10_000),
  ])

  const stores = (storesRes.data ?? []) as StoreRow[]
  const byStore = new Map(((settingsRes.data ?? []) as SettingRow[]).map((s) => [s.store_id, s]))

  const rows: SecuritySetting[] = stores.map((st) => {
    const cfg = byStore.get(st.id)
    return {
      storeId: st.id,
      storeName: st.name,
      areaCode: st.area_code,
      enabled: cfg?.enabled ?? false,
      patrolTimes: cfg?.patrol_times ?? [],
      notifyEmails: cfg?.notify_emails ?? [],
    }
  })

  return (
    <AdminShell pathname="/security/settings" section="security">
      <PageHeader
        title={ts.title}
        crumb={[
          { href: '/security', label: t.breadcrumb.security },
          { href: '/security/settings', label: ts.title },
        ]}
      />
      <div className="space-y-3 px-5 py-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-relaxed text-blue-800/90 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200/80">
          店舗ごとに<b>1日最大4回の巡回時刻</b>を指定します（全曜日実施）。有効の店舗は指定時刻に自動巡回します。
          絞り込み・複数選択して<b>一括設定</b>も可能です。巡回結果は<b>巡回レポート</b>で確認できます。
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-gedink3">店舗がありません。</p>
        ) : (
          <SecuritySettingsTable initialRows={rows} />
        )}
      </div>
    </AdminShell>
  )
}
