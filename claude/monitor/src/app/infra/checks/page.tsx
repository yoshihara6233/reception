/**
 * /infra/checks — チェック設定一覧
 *
 * monitor_checks の現状を読み取り専用で表示。 v4.0 で全文 i18n 化（4 言語切替対応）。
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { getT } from '@/lib/i18n/server'

interface CheckRow {
  id: string
  store_id: string | null
  target_type: 'edge' | 'recorder' | 'camera'
  target_id: string
  check_type: 'heartbeat' | 'ping' | 'probe_camera' | 'storage' | 'recording_gap' | 'ntp' | 'tamper' | 'version'
  interval_min: number
  enabled: boolean
  consec_fail: number
  consec_ok: number
  last_run_at: string | null
}
interface StoreRow { id: string; name: string }

function fmtJst(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default async function InfraChecksPage() {
  const supa = await createSupabaseServer()
  const t = await getT()

  const [checksRes, storesRes] = await Promise.all([
    supa.from('monitor_checks')
      .select('id, store_id, target_type, target_id, check_type, interval_min, enabled, consec_fail, consec_ok, last_run_at')
      .order('store_id', { ascending: true })
      .limit(2_000),
    supa.from('stores').select('id, name').limit(10_000),
  ])

  const checks   = (checksRes.data ?? []) as CheckRow[]
  const storeMap = new Map(((storesRes.data ?? []) as StoreRow[]).map((s) => [s.id, s.name]))

  const enabled  = checks.filter((c) => c.enabled).length
  const failing  = checks.filter((c) => c.enabled && c.consec_fail > 0).length

  return (
    <AdminShell pathname="/infra/checks" section="infra">
      <PageHeader
        title={t.infraChecks.title}
        crumb={[
          { href: '/infra',        label: t.breadcrumb.infra },
          { href: '/infra/checks', label: t.breadcrumb.infraChecks },
        ]}
      />
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-3 gap-3">
          <Stat label={t.infraChecks.statRegistered} value={checks.length} />
          <Stat label={t.infraChecks.statEnabled}    value={enabled} />
          <Stat label={t.infraChecks.statFailing}    value={failing} tone={failing > 0 ? 'danger' : undefined} />
        </div>

        {checks.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-gedink3">{t.infraChecks.empty}</p>
        ) : (
          <div className="overflow-hidden rounded border border-slate-200 dark:border-gedline">
            <table className="min-w-full divide-y divide-slate-200 text-xs dark:divide-gedline">
              <thead className="bg-slate-50 dark:bg-gedbg3">
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 dark:text-gedink3">
                  <th className="px-3 py-1.5">{t.infraChecks.colStore}</th>
                  <th className="px-3 py-1.5">{t.infraChecks.colTarget}</th>
                  <th className="px-3 py-1.5">{t.infraChecks.colCheckType}</th>
                  <th className="px-3 py-1.5">{t.infraChecks.colInterval}</th>
                  <th className="px-3 py-1.5">{t.infraChecks.colStatus}</th>
                  <th className="px-3 py-1.5">{t.infraChecks.colConsecFail}</th>
                  <th className="px-3 py-1.5">{t.infraChecks.colLastRun}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-gedline">
                {checks.map((c) => (
                  <tr key={c.id} className="text-slate-700 dark:text-gedink">
                    <td className="px-3 py-1.5">{c.store_id ? (storeMap.get(c.store_id) ?? t.common.dash) : t.common.dash}</td>
                    <td className="px-3 py-1.5 capitalize">{c.target_type}</td>
                    <td className="px-3 py-1.5">{t.infraChecks.checkLabel[c.check_type] ?? c.check_type}</td>
                    <td className="px-3 py-1.5 font-mono tabular-nums">{c.interval_min} {t.infraChecks.intervalSuffix}</td>
                    <td className="px-3 py-1.5">
                      <span
                        className={
                          'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ' +
                          (c.enabled
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-500 dark:bg-gedbg3 dark:text-gedink3')
                        }
                      >
                        {c.enabled ? t.infraChecks.enabled : t.infraChecks.disabled}
                      </span>
                    </td>
                    <td className={'px-3 py-1.5 font-mono tabular-nums ' + (c.consec_fail > 0 ? 'text-red-600 dark:text-red-400' : '')}>
                      {c.consec_fail}
                    </td>
                    <td className="px-3 py-1.5 font-mono tabular-nums">{fmtJst(c.last_run_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'danger' }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-4 py-3 dark:border-gedline dark:bg-gedbg2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-gedink3">{label}</div>
      <div
        className={
          'mt-1 text-2xl font-bold tabular-nums ' +
          (tone === 'danger' ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-gedink')
        }
      >
        {value}
      </div>
    </div>
  )
}
