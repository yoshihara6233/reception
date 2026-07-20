/**
 * /baggage/settings — 手荷物検査 店舗設定（M4・店舗固有のみ）
 *
 * 店舗固有は「有効化・検査台カメラ（最大2台）」のみ。保持期間・タイムアウト・端末
 * モード・音声・STEP文言はテナント共通（/admin/baggage）で一元管理する。
 * カメラは recorder_cameras → recorders → edge_devices の店舗紐付けで解決。
 */
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { BAGGAGE_NAV, BAGGAGE_NAV_TITLE } from '../nav'
import { SettingsClient, type SettingsForm } from './SettingsClient'

export default async function BaggageSettingsPage(
  { searchParams }: { searchParams: Promise<{ store?: string }> },
) {
  const sp = await searchParams
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  // stores の RLS はテナント全体を返すため、store_manager 等は担当店舗に絞る
  // （employees ページ・API 側 requireBaggageAccess と同じスコープ）。
  const [{ data: stores }, { data: profile }] = await Promise.all([
    supa.from('stores').select('id, name').order('name'),
    supa.from('admin_users').select('role, store_ids').eq('auth_user_id', user.id).maybeSingle(),
  ])
  const allStores = (stores ?? []) as { id: string; name: string }[]
  const isWide = profile?.role === 'super_admin' || profile?.role === 'tenant_admin'
  const allowed = new Set((profile?.store_ids ?? []) as string[])
  const storeOptions = isWide ? allStores : allStores.filter((s) => allowed.has(s.id))
  const storeId = sp.store && storeOptions.some((s) => s.id === sp.store) ? sp.store : storeOptions[0]?.id

  let form: SettingsForm | null = null
  let cameras: { id: string; name: string; channel: number }[] = []
  if (storeId) {
    const svc = createSupabaseService()
    const [{ data: s }, { data: cams }] = await Promise.all([
      svc.from('inspection_settings').select('enabled, camera_ids').eq('store_id', storeId).maybeSingle(),
      svc.from('recorder_cameras')
        .select('id, name, channel, recorders!inner ( edge_devices!inner ( store_id ) )')
        .eq('recorders.edge_devices.store_id', storeId)
        .eq('enabled', true)
        .order('channel'),
    ])
    cameras = ((cams ?? []) as { id: string; name: string; channel: number }[])
      .map(({ id, name, channel }) => ({ id, name, channel }))
    form = {
      storeId,
      enabled: s?.enabled ?? false,
      cameraIds: ((s?.camera_ids ?? []) as string[]).filter((id) => cameras.some((c) => c.id === id)),
    }
  }

  return (
    <AdminShell pathname="/baggage/settings" nav={BAGGAGE_NAV} navTitle={BAGGAGE_NAV_TITLE}>
      <PageHeader title="手荷物検査 設定" crumb={[{ href: '/baggage', label: BAGGAGE_NAV_TITLE }]} />
      <div className="p-5">
        {!storeId || !form ? (
          <div className="rounded border border-slate-200 bg-white p-6 text-sm text-slate-600 dark:border-gedline dark:bg-gedbg2 dark:text-gedink2">
            表示できる店舗がありません。
          </div>
        ) : (
          <SettingsClient storeOptions={storeOptions} initial={form} cameras={cameras} />
        )}
      </div>
    </AdminShell>
  )
}
