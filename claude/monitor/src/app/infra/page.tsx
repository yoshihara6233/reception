/**
 * /infra — インフラ ヘルス ダッシュボード（テナント管理者向け）
 *
 * 拠点ロールアップ ヘルス表（店舗行 × 機器種別列）。設計判断 D2（ロールアップ表）/
 * D3（一斉stale=接続障害バナー）。P1: edge死活は last_seen_at から、レコーダ/カメラは
 * 能動チェック（P2）未実装のため「未検証」。未対応は monitor_incidents から。
 * テナントスコープは RLS（admin_users.auth_user_id）が自動適用。
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { getT } from '@/lib/i18n/server'
import { LifecycleSummary } from '@/components/nvr/LifecycleSummary'

// 5状態パレット（色のみ。ラベルは t.infraDashboard.healthLabel から取得）
const HEALTH_COLOR = {
  ok:    '#2F7A4F',
  warn:  '#B5761A',
  fail:  '#A3332B',
  unk:   '#8C8C90',
  maint: '#2C4A7E',
} as const
type Health = keyof typeof HEALTH_COLOR

interface CamRow { id: string }
interface RecRow { id: string; recorder_cameras: CamRow[] | null }
interface EdgeRow { id: string; name: string; status: string; last_seen_at: string | null; recorders: RecRow[] | null }
interface StoreRow { id: string; name: string; edge_devices: EdgeRow[] | null }
interface SettingRow { store_id: string; enabled: boolean; edge_offline_threshold_min: number; maintenance_until: string | null }
interface IncidentRow { store_id: string | null; target_type: string; kind: string; status: string }

function fmtJST(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' })
}

function Dot({ h }: { h: Health }) {
  return <span className="inline-block h-2.5 w-2.5 flex-none rounded-full" style={{ background: HEALTH_COLOR[h] }} />
}

export default async function InfraDashboard() {
  const supa = await createSupabaseServer()
  const t = await getT()
  const tInfra = t.infraDashboard
  const HEALTH_LABEL = tInfra.healthLabel

  const [storesRes, settingsRes, incidentsRes] = await Promise.all([
    supa.from('stores')
      .select('id, name, edge_devices ( id, name, status, last_seen_at, recorders ( id, recorder_cameras ( id ) ) )')
      .order('name').limit(10_000),
    supa.from('monitor_settings').select('store_id, enabled, edge_offline_threshold_min, maintenance_until').limit(10_000),
    supa.from('monitor_incidents').select('store_id, target_type, kind, status').in('status', ['open', 'ack']).limit(10_000),
  ])

  const stores = (storesRes.data ?? []) as unknown as StoreRow[]
  const settings = new Map((((settingsRes.data ?? []) as SettingRow[]).map((s) => [s.store_id, s])))
  const incidents = (incidentsRes.data ?? []) as IncidentRow[]

  // 一斉stale（接続障害）バナー: tenant network_outage が open
  const networkOutage = incidents.some((i) => i.target_type === 'tenant' && i.kind === 'network_outage')

  const openByStore = new Map<string, number>()
  for (const i of incidents) {
    if (!i.store_id) continue
    openByStore.set(i.store_id, (openByStore.get(i.store_id) ?? 0) + 1)
  }

  const now = Date.now()
  const rows = stores.map((st) => {
    const cfg = settings.get(st.id)
    const enabled = cfg?.enabled ?? false
    const thresholdMs = (cfg?.edge_offline_threshold_min ?? 5) * 60_000
    const inMaint = cfg?.maintenance_until ? new Date(cfg.maintenance_until).getTime() > now : false

    const edges = st.edge_devices ?? []
    const recCount = edges.reduce((n, e) => n + (e.recorders?.length ?? 0), 0)
    const camCount = edges.reduce((n, e) => n + (e.recorders ?? []).reduce((m, r) => m + (r.recorder_cameras?.length ?? 0), 0), 0)

    // edge health（P1: heartbeat 鮮度）
    let edgeHealth: Health
    if (inMaint) edgeHealth = 'maint'
    else if (edges.length === 0) edgeHealth = 'unk'
    else {
      const anyStale = edges.some((e) => !e.last_seen_at || (now - new Date(e.last_seen_at).getTime()) > thresholdMs)
      // 接続障害疑い時は個別赤を抑制し未検証に
      edgeHealth = anyStale ? (networkOutage ? 'unk' : 'fail') : 'ok'
    }
    // recorder/camera: P1 は能動チェック未実装 → 未検証（メンテ中は maint）
    const devHealth: Health = inMaint ? 'maint' : 'unk'

    return {
      id: st.id, name: st.name, enabled, inMaint,
      edgeHealth, devHealth, recCount, camCount,
      open: openByStore.get(st.id) ?? 0,
      lastSeen: edges[0]?.last_seen_at ?? null,
    }
  })

  const monitored = rows.filter((r) => r.enabled)
  const totalOpen = incidents.length
  const allHealthy = totalOpen === 0 && monitored.length > 0

  return (
    <AdminShell pathname="/infra" section="infra">
      <PageHeader title={tInfra.title} crumb={[{ href: '/infra', label: t.breadcrumb.infra }]} />

      <div className="px-5 py-4 space-y-4">
        {/* 接続障害バナー (D3) */}
        {networkOutage && (
          <div className="flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 dark:border-[#A3332B]/50 dark:bg-[#A3332B]/15">
            <span className="text-lg">⚠</span>
            <div className="text-sm text-red-800 dark:text-[#E87D74]">
              <b>{tInfra.networkOutageTitle}</b> — {tInfra.networkOutageBody}
            </div>
          </div>
        )}

        {/* 統計 */}
        <div className="grid grid-cols-4 gap-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tInfra.statMonitored}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{monitored.length}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tInfra.statOpen}</div>
            <div className={'mt-1 text-2xl font-bold tabular-nums ' + (totalOpen > 0 ? 'text-red-600 dark:text-[#E87D74]' : 'text-slate-900')}>{totalOpen}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tInfra.statUptime30d}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{t.common.dash}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tInfra.statActiveChecks}</div>
            <div className="mt-1 text-sm font-medium text-slate-500">{tInfra.activeChecksP2}</div>
          </div>
        </div>

        {/* F48.D: NVR 機材ライフサイクル サマリ */}
        <LifecycleSummary />

        {/* 凡例 */}
        <div className="flex flex-wrap gap-4 text-[11px] text-slate-600 dark:text-gedink2">
          {tInfra.legendStatus}
          {(Object.keys(HEALTH_COLOR) as Health[]).map((h) => (
            <span key={h} className="inline-flex items-center gap-1.5"><Dot h={h} />{HEALTH_LABEL[h]}</span>
          ))}
        </div>

        {allHealthy ? (
          /* 全拠点正常（最頻出） */
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-6 dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-xl text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">✓</span>
              <div>
                <p className="text-base font-bold text-emerald-800 dark:text-emerald-300">{tInfra.allHealthyTitle(monitored.length)}</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400/80">{tInfra.allHealthyBody}</p>
              </div>
            </div>
          </div>
        ) : null}

        {/* 拠点ヘルス表 (D2) — allHealthy でも一覧は表示 */}
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-gedline dark:bg-gedbg2">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:bg-gedbg3 dark:text-gedink3">
              <tr>
                <th className="px-3 py-2 text-left">{tInfra.colStore}</th>
                <th className="px-3 py-2 text-left">{tInfra.colEdge}</th>
                <th className="px-3 py-2 text-left">{tInfra.colRecorder}</th>
                <th className="px-3 py-2 text-left">{tInfra.colCamera}</th>
                <th className="px-3 py-2 text-left">{tInfra.colOpen}</th>
                <th className="px-3 py-2 text-left">{tInfra.colLastSeen}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}
                  className={'border-t border-slate-100 dark:border-gedline ' +
                    (r.open > 0 ? 'shadow-[inset_2px_0_0_#A3332B]' : '')}>
                  <td className="px-3 py-2 font-medium text-slate-800 dark:text-gedink">
                    {r.name}
                    {!r.enabled && <span className="ml-1 text-[10px] text-slate-400 dark:text-gedink3">{tInfra.notMonitored}</span>}
                    {r.inMaint && <span className="ml-1 text-[10px]" style={{ color: HEALTH_COLOR.maint }}>{tInfra.inMaintenance}</span>}
                  </td>
                  <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><Dot h={r.edgeHealth} />{HEALTH_LABEL[r.edgeHealth]}</span></td>
                  <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><Dot h={r.devHealth} /><span className="font-mono tabular-nums text-slate-600 dark:text-gedink2">{r.recCount}</span></span></td>
                  <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5"><Dot h={r.devHealth} /><span className="font-mono tabular-nums text-slate-600 dark:text-gedink2">{r.camCount}</span></span></td>
                  <td className="px-3 py-2">
                    {r.open > 0
                      ? <span className="inline-block rounded bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">{tInfra.incidentCount(r.open)}</span>
                      : <span className="text-slate-400 dark:text-gedink3">{t.common.dash}</span>}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums text-slate-500 dark:text-gedink3">{fmtJST(r.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-slate-500 dark:text-gedink3">{tInfra.emptyStores}</p>
          )}
        </div>

        <p className="text-[11px] text-slate-400 dark:text-gedink3">
          {tInfra.footerNote}
        </p>
      </div>
    </AdminShell>
  )
}
