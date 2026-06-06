/**
 * /security/cameras — カメラ別 巡回設定
 *
 * カメラごとに比較プロンプト・感度・ベースライン画像・巡回有効化を編集。
 * ベースライン画像の自動取得はエッジ連携（capture_snapshot）後に対応。現状はURL手動。
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { CameraRow, type CameraConfig } from './CameraConfigForm'
import { getT } from '@/lib/i18n/server'

interface CamRow {
  id: string
  name: string
  channel: number
  recorders: { edge_devices: { store_id: string; stores: { name: string } | null } | null } | null
}

interface ConfigRow {
  camera_id: string
  baseline_day_url: string | null
  baseline_night_url: string | null
  ai_prompt: string | null
  sensitivity: number
  patrol_enabled: boolean
}

export default async function SecurityCamerasPage() {
  const supa = await createSupabaseServer()
  const t = await getT()
  const tc = t.securityCameras

  const [camsRes, cfgRes] = await Promise.all([
    supa
      .from('recorder_cameras')
      .select('id, name, channel, recorders ( edge_devices ( store_id, stores ( name ) ) )')
      .order('channel')
      .limit(10_000),
    supa
      .from('security_camera_config')
      .select('camera_id, baseline_day_url, baseline_night_url, ai_prompt, sensitivity, patrol_enabled')
      .limit(10_000),
  ])

  const cams = (camsRes.data ?? []) as unknown as CamRow[]
  const cfgs = (cfgRes.data ?? []) as ConfigRow[]
  const byCam = new Map(cfgs.map((c) => [c.camera_id, c]))

  // Group cameras by store name
  const groups = new Map<string, CameraConfig[]>()
  for (const c of cams) {
    const storeName = c.recorders?.edge_devices?.stores?.name ?? tc.unassigned
    const cfg = byCam.get(c.id)
    const item: CameraConfig = {
      cameraId: c.id,
      cameraName: c.name,
      channel: c.channel,
      aiPrompt: cfg?.ai_prompt ?? '',
      sensitivity: cfg?.sensitivity ?? 0.3,
      patrolEnabled: cfg?.patrol_enabled ?? true,
      baselineDayUrl: cfg?.baseline_day_url ?? '',
      baselineNightUrl: cfg?.baseline_night_url ?? '',
    }
    if (!groups.has(storeName)) groups.set(storeName, [])
    groups.get(storeName)!.push(item)
  }

  return (
    <AdminShell pathname="/security/cameras" section="security">
      <PageHeader
        title={tc.title}
        crumb={[{ href: '/security', label: t.breadcrumb.security }, { href: '/security/cameras', label: tc.title }]}
      />
      <div className="px-5 py-4 space-y-6">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-[#B5761A]/40 dark:bg-[#B5761A]/15 dark:text-[#E2A55A]">
          {tc.promptNotice}
        </p>
        {[...groups.entries()].map(([storeName, items]) => (
          <div key={storeName}>
            <h2 className="mb-2 text-xs font-bold text-slate-700 dark:text-gedink2">{storeName}{tc.storeWithCount(items.length)}</h2>
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-gedline dark:bg-gedbg2">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:bg-gedbg3 dark:text-gedink3">
                  <tr>
                    <th className="px-3 py-2 text-left">{tc.colCamera}</th>
                    <th className="px-3 py-2 text-left">{tc.colPatrolShort}</th>
                    <th className="px-3 py-2 text-left">{tc.colPrompt}</th>
                    <th className="px-3 py-2 text-left">{tc.colSensitivity}</th>
                    <th className="px-3 py-2 text-left">{tc.colBaselineUrls}</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => <CameraRow key={c.cameraId} cam={c} />)}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {groups.size === 0 && (
          <p className="text-xs text-slate-500 dark:text-gedink3">{tc.empty}</p>
        )}
      </div>
    </AdminShell>
  )
}
