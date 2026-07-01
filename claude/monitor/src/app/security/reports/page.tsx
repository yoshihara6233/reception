/**
 * /security/reports — 巡回レポート一覧 (v4.0 で i18n 化)
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { ReportImagesButton } from '../ReportImagesButton'
import { getT } from '@/lib/i18n/server'

interface ReportRow {
  id: string
  store_id: string | null
  period_from: string
  period_to: string
  pdf_url: string | null
  generated_at: string | null
  sent_to_emails: string[] | null
  created_at: string
}
interface StoreRow { id: string; name: string }
interface RunRow      { id: string; store_id: string; started_at: string; status: string }
interface FindingRow  { run_id: string; status: string }

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
}
function fmtJst(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

interface ReportStats { runs: number; doneRuns: number; anomalies: number; reviews: number; total: number }

function statsForReport(
  report: ReportRow,
  runs: RunRow[],
  findingsByRunId: Map<string, FindingRow[]>,
): ReportStats {
  const from = new Date(report.period_from).getTime()
  const to   = new Date(report.period_to).getTime()
  const periodRuns = runs.filter((r) => {
    if (report.store_id && r.store_id !== report.store_id) return false
    const t = new Date(r.started_at).getTime()
    return t >= from && t <= to
  })
  const doneRuns = periodRuns.filter((r) => r.status === 'done').length
  let anomalies = 0, reviews = 0, total = 0
  for (const r of periodRuns) {
    const fs = findingsByRunId.get(r.id) ?? []
    total += fs.length
    for (const f of fs) {
      if (f.status === 'anomaly' || f.status === 'confirmed') anomalies++
      else if (f.status === 'review') reviews++
    }
  }
  return { runs: periodRuns.length, doneRuns, anomalies, reviews, total }
}

export default async function SecurityReportsPage() {
  const supa = await createSupabaseServer()
  const t = await getT()

  const [reportsRes, storesRes, runsRes, findingsRes] = await Promise.all([
    supa.from('security_reports')
      .select('id, store_id, period_from, period_to, pdf_url, generated_at, sent_to_emails, created_at')
      .order('period_from', { ascending: false })
      .limit(500),
    supa.from('stores').select('id, name').limit(10_000),
    supa.from('patrol_runs').select('id, store_id, started_at, status').limit(5_000),
    supa.from('patrol_findings').select('run_id, status').limit(20_000),
  ])

  const reports  = (reportsRes.data ?? []) as ReportRow[]
  const stores   = (storesRes.data ?? []) as StoreRow[]
  const runs     = (runsRes.data ?? []) as RunRow[]
  const findings = (findingsRes.data ?? []) as FindingRow[]
  const storeMap = new Map(stores.map((s) => [s.id, s.name]))

  const findingsByRun = new Map<string, FindingRow[]>()
  for (const f of findings) {
    const arr = findingsByRun.get(f.run_id)
    if (arr) arr.push(f)
    else findingsByRun.set(f.run_id, [f])
  }

  const totalRuns   = runs.length
  const doneRuns    = runs.filter((r) => r.status === 'done').length
  const anomalies   = findings.filter((f) => f.status === 'anomaly' || f.status === 'confirmed').length
  const reviewQueue = findings.filter((f) => f.status === 'review').length

  return (
    <AdminShell pathname="/security/reports" section="security">
      <PageHeader
        title={t.securityReports.title}
        crumb={[
          { href: '/security',         label: t.breadcrumb.security },
          { href: '/security/reports', label: t.breadcrumb.securityReports },
        ]}
      />

      <div className="space-y-5 p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t.securityReports.statRegistered} value={reports.length} />
          <Stat label={t.securityReports.statTotalRuns}  value={totalRuns} sub={t.securityReports.statTotalRunsSub(doneRuns)} />
          <Stat label={t.securityReports.statAnomalies}  value={anomalies}   tone={anomalies > 0 ? 'danger' : undefined} />
          <Stat label={t.securityReports.statReviews}    value={reviewQueue} tone={reviewQueue > 0 ? 'warn' : undefined} />
        </div>

        {reports.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-gedink3">{t.securityReports.empty}</p>
        ) : (
          <div className="overflow-hidden rounded border border-slate-200 dark:border-gedline">
            <table className="min-w-full divide-y divide-slate-200 text-xs dark:divide-gedline">
              <thead className="bg-slate-50 dark:bg-gedbg3">
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 dark:text-gedink3">
                  <th className="px-3 py-1.5">{t.securityReports.colStore}</th>
                  <th className="px-3 py-1.5">{t.securityReports.colPeriod}</th>
                  <th className="px-3 py-1.5">{t.securityReports.colGenerated}</th>
                  <th className="px-3 py-1.5 text-center">{t.securityReports.colRuns}</th>
                  <th className="px-3 py-1.5 text-center">{t.securityReports.colDone}</th>
                  <th className="px-3 py-1.5 text-center">{t.securityReports.colAnomalies}</th>
                  <th className="px-3 py-1.5 text-center">{t.securityReports.colReviews}</th>
                  <th className="px-3 py-1.5">{t.securityReports.colPdf}</th>
                  <th className="px-3 py-1.5">画像</th>
                  <th className="px-3 py-1.5">{t.securityReports.colEmails}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-gedline">
                {reports.map((r) => {
                  const s = statsForReport(r, runs, findingsByRun)
                  return (
                    <tr key={r.id} className="text-slate-700 dark:text-gedink">
                      <td className="px-3 py-1.5">{r.store_id ? (storeMap.get(r.store_id) ?? t.common.dash) : t.common.dash}</td>
                      <td className="px-3 py-1.5 font-mono tabular-nums">
                        {fmtDay(r.period_from)} 〜 {fmtDay(r.period_to)}
                      </td>
                      <td className="px-3 py-1.5 font-mono tabular-nums">{fmtJst(r.generated_at)}</td>
                      <td className="px-3 py-1.5 text-center font-mono tabular-nums">{s.runs}</td>
                      <td className="px-3 py-1.5 text-center font-mono tabular-nums">{s.doneRuns}</td>
                      <td className={'px-3 py-1.5 text-center font-mono tabular-nums ' +
                          (s.anomalies > 0 ? 'text-red-600 dark:text-red-400 font-semibold' : '')}>
                        {s.anomalies}
                      </td>
                      <td className={'px-3 py-1.5 text-center font-mono tabular-nums ' +
                          (s.reviews > 0 ? 'text-amber-600 dark:text-amber-400' : '')}>
                        {s.reviews}
                      </td>
                      <td className="px-3 py-1.5">
                        {r.pdf_url ? (
                          <a href={r.pdf_url} target="_blank" rel="noopener noreferrer"
                             className="text-blue-600 underline hover:text-blue-800 dark:text-gedaccent">
                            {t.common.open}
                          </a>
                        ) : (
                          <span className="text-slate-400 dark:text-gedink3">{t.common.notGenerated}</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <ReportImagesButton reportId={r.id} count={s.total} />
                      </td>
                      <td className="max-w-xs truncate px-3 py-1.5 text-slate-500 dark:text-gedink3">
                        {r.sent_to_emails && r.sent_to_emails.length > 0
                          ? r.sent_to_emails.join(', ')
                          : t.common.dash}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  )
}

function Stat({
  label, value, sub, tone,
}: { label: string; value: number; sub?: string; tone?: 'danger' | 'warn' }) {
  const toneCls =
    tone === 'danger' ? 'text-red-600 dark:text-red-400' :
    tone === 'warn'   ? 'text-amber-600 dark:text-amber-400' :
                        'text-slate-900 dark:text-gedink'
  return (
    <div className="rounded border border-slate-200 bg-white px-4 py-3 dark:border-gedline dark:bg-gedbg2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-gedink3">{label}</div>
      <div className={'mt-1 text-2xl font-bold tabular-nums ' + toneCls}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 dark:text-gedink3">{sub}</div>}
    </div>
  )
}
