/**
 * /baggage/settings — 手荷物検査 店舗設定（M4）
 *
 * 有効化・検査台カメラ（最大2台）・保持期間・端末モード・音声・STEP文言を編集。
 * 店舗は RLS で可視な範囲。カメラは recorder_cameras → recorders → edge_devices の
 * 店舗紐付けで解決（service 読み・可視性は店舗選択肢が RLS 由来なことで担保）。
 */
import { redirect } from 'next/navigation'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { BAGGAGE_NAV, BAGGAGE_NAV_TITLE } from '../nav'
import { normalizeAnnounceSteps } from '@/lib/baggage/inspection-flow'
import { SettingsClient, type SettingsForm } from './SettingsClient'

export default async function BaggageSettingsPage(
  { searchParams }: { searchParams: Promise<{ store?: string }> },
) {
  const sp = await searchParams
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  const { data: stores } = await supa.from('stores').select('id, name').order('name')
  const storeOptions = (stores ?? []) as { id: string; name: string }[]
  const storeId = sp.store && storeOptions.some((s) => s.id === sp.store) ? sp.store : storeOptions[0]?.id

  let form: SettingsForm | null = null
  let cameras: { id: string; name: string; channel: number }[] = []
  if (storeId) {
    const svc = createSupabaseService()
    const [{ data: s }, { data: cams }] = await Promise.all([
      svc.from('inspection_settings').select('*').eq('store_id', storeId).maybeSingle(),
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
      retentionDays: s?.retention_days ?? 60,
      nvrRetentionDays: s?.nvr_retention_days ?? 14,
      timeoutSec: s?.inspection_timeout_sec ?? 120,
      terminalMode: (s?.terminal_mode ?? 'both') as SettingsForm['terminalMode'],
      audioEnabled: s?.audio_enabled ?? true,
      audioVolume: Number(s?.audio_volume ?? 1),
      steps: normalizeAnnounceSteps(s?.announce_steps),
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
