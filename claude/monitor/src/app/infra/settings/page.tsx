/**
 * /infra/settings — 監視設定（店舗別・一覧＋一括変更）
 *
 * 店舗ごとに監視の有効化・エッジ無応答閾値・チェック間隔・デバウンス閾値・通知先・
 * メンテ窓を設定。/security/settings（巡回設定）と同形の一覧UI
 * （絞り込み・複数選択・一括設定）。テナントスコープは RLS で自動適用。
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { MonitorSettingsTable, type MonitorSetting } from './MonitorSettingsTable'
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

  // 死活監視は super_admin 専用の全テナント横断ビュー（infra/layout でゲート済）。
  const [storesRes, settingsRes] = await Promise.all([
    supa.from('stores').select('id, name, area_code').eq('is_active', true)
      .order('area_code', { ascending: true, nullsFirst: false }).order('name').limit(10_000),
    supa.from('monitor_settings').select('store_id, enabled, edge_offline_threshold_min, check_interval_min, fail_threshold, ok_threshold, notify_emails, maintenance_until').limit(10_000),
  ])

  const stores = (storesRes.data ?? []) as StoreRow[]
  const byStore = new Map(((settingsRes.data ?? []) as SettingRow[]).map((s) => [s.store_id, s]))

  const rows: MonitorSetting[] = stores.map((st) => {
    const c = byStore.get(st.id)
    return {
      storeId: st.id,
      storeName: st.name,
      areaCode: st.area_code,
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
      <div className="space-y-3 px-5 py-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-relaxed text-blue-800/90 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200/80">
          店舗ごとに<b>エッジ無応答の判定閾値・チェック間隔・発報/解決のデバウンス・通知先・メンテ窓</b>を設定します。
          絞り込み・複数選択して<b>一括設定</b>も可能です。障害の発生状況は<b>ダッシュボード</b>と<b>稼働率レポート</b>で確認できます。
        </div>
        <MonitorSettingsTable initialRows={rows} />
      </div>
    </AdminShell>
  )
}
