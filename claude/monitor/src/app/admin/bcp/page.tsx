/**
 * /admin/bcp — BCP 発動条件（店舗別）
 *
 * J-Alert 連動 BCP 自動録画を、店舗ごとに「どの発令で起動するか」設定する:
 *   - 地震    : 最大震度しきい値（既定 5強以上）
 *   - 津波    : ON/OFF（既定 ON）
 *   - ミサイル : ON/OFF（既定 ON）
 *   - 録画前後分・通知先
 * 条件未満の発令も /bcp/jalerts の受信履歴には残る（録画を起動しないだけ）。
 */
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { resolveAdminContext } from '@/lib/tenant/acting'
import { AdminShell } from '@/components/AdminShell'
import { AdminDenied } from '@/components/admin/AdminDenied'
import { PageHeader } from '@/components/admin/PageHeader'
import { requireAdmin } from '@/lib/admin/guard'
import { type BcpStoreSetting } from './BcpSettingsForm'
import { BcpSettingsTable } from './BcpSettingsTable'

interface StoreRow { id: string; name: string; area_code: string | null }
interface SettingRow {
  store_id: string
  enabled: boolean
  quake_min_intensity: string | null
  tsunami_enabled: boolean | null
  missile_enabled: boolean | null
  notify_emails: string[] | null
  snapshot_offsets: number[] | null
}

export default async function AdminBcpPage() {
  // 発動条件は設定＝ADMIN_ROLES の持ち物。書き込みは bcp_settings_modify の
  // RLS が拒むが、閲覧者(viewer)が設定画面自体に入れてしまっていた。
  const guard = await requireAdmin()
  if (!guard.ok) {
    if (guard.status === 401) redirect('/login')
    return <AdminDenied pathname="/admin/bcp" />
  }
  const supa = await createSupabaseServer()

  // BCP発動条件は店舗別＝①設定プレーン。操作中テナント（tenant_admin=自テナント /
  // super_admin=選択中テナント）に絞る。未選択の super_admin のみ全店舗を閲覧。
  const ctx = await resolveAdminContext(supa)

  let storesQuery = supa
    .from('stores')
    .select('id, name, area_code')
    .order('area_code', { ascending: true, nullsFirst: false })
    .order('name')
    .limit(10_000)
  // 店舗限定ロール(store_manager等)は担当店舗のみ。テナントロールはテナント全体。
  if (ctx.storeIds) storesQuery = storesQuery.in('id', ctx.storeIds)
  else if (ctx.tenantId) storesQuery = storesQuery.eq('tenant_id', ctx.tenantId)

  const [storesRes, settingsRes] = await Promise.all([
    storesQuery,
    supa.from('bcp_settings').select('store_id, enabled, quake_min_intensity, tsunami_enabled, missile_enabled, notify_emails, snapshot_offsets').limit(10_000),
  ])

  const stores   = (storesRes.data   ?? []) as StoreRow[]
  const settings = (settingsRes.data ?? []) as SettingRow[]
  const byStore  = new Map(settings.map((s) => [s.store_id, s]))

  const rows: BcpStoreSetting[] = stores.map((st) => {
    const cfg = byStore.get(st.id)
    return {
      storeId:           st.id,
      storeName:         st.name,
      areaCode:          st.area_code,
      enabled:           cfg?.enabled ?? false,
      quakeMinIntensity: cfg?.quake_min_intensity ?? '5+',
      tsunamiEnabled:    cfg?.tsunami_enabled ?? true,
      missileEnabled:    cfg?.missile_enabled ?? true,
      notifyEmails:      cfg?.notify_emails ?? [],
      snapshotOffsets:   cfg?.snapshot_offsets ?? [-5, 5],
    }
  })

  return (
    <AdminShell pathname="/admin/bcp" section="admin">
      <PageHeader
        title="BCP発動条件"
        crumb={[{ href: '/admin', label: '設定' }, { href: '/admin/bcp', label: 'BCP発動条件' }]}
      />
      <div className="space-y-3 px-5 py-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-relaxed text-blue-800/90 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200/80">
          店舗ごとに、J-Alert 連動の<b>BCPレポート自動作成</b>を設定します。
          地震は<b>最大震度のしきい値</b>、津波・ミサイルは ON/OFF、<b>撮影タイミング</b>で写真枚数を選べます。
          絞り込み・複数選択して<b>一括設定</b>も可能。条件未満の発令も<b>受信履歴</b>には残ります。
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-gedink3">店舗がありません。</p>
        ) : (
          <BcpSettingsTable initialRows={rows} />
        )}
      </div>
    </AdminShell>
  )
}
