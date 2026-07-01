/**
 * /security/reports — 巡回レポート一覧 (v4.0 で i18n 化)
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { ReportsTable, type ReportRowVM } from './ReportsTable'
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
interface RunRow      { id: string; store_id: string; started_at: string; status: string; trigger: string }
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
    supa.from('patrol_runs').select('id, store_id, started_at, status, trigger').limit(5_000),
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

  // 種別判定用: run を (store_id|開始msの) で引けるようにする。
  const runByKey = new Map<string, RunRow>()
  for (const r of runs) runByKey.set(`${r.store_id}|${new Date(r.started_at).getTime()}`, r)
  const TRIGGER_LABEL: Record<string, string> = { manual: '手動', scheduled: '定時', emergency: '緊急' }

  function kindLabel(rep: ReportRow): string {
    // 期間が span（日次ロールアップ）→ 定例。点（period_from==period_to）→ 該当 run の trigger。
    if (new Date(rep.period_from).getTime() !== new Date(rep.period_to).getTime()) return '定例'
    const run = rep.store_id ? runByKey.get(`${rep.store_id}|${new Date(rep.period_from).getTime()}`) : undefined
    return TRIGGER_LABEL[run?.trigger ?? ''] ?? '個別'
  }

  const rows: ReportRowVM[] = reports.map((r) => {
    const s = statsForReport(r, runs, findingsByRun)
    return {
      id: r.id,
      storeName: r.store_id ? (storeMap.get(r.store_id) ?? t.common.dash) : t.common.dash,
      kind: kindLabel(r),
      dateLabel: fmtDay(r.period_from),
      generatedLabel: fmtJst(r.generated_at),
      runs: s.runs,
      pdfUrl: r.pdf_url,
      emails: (r.sent_to_emails ?? []).join(', '),
      count: s.total,
    }
  })

  return (
    <AdminShell pathname="/security/reports" section="security">
      <PageHeader
        title={t.securityReports.title}
        crumb={[
          { href: '/security',         label: t.breadcrumb.security },
          { href: '/security/reports', label: t.breadcrumb.securityReports },
        ]}
      />

      <div className="space-y-4 p-5">
        <ReportsTable rows={rows} />
      </div>
    </AdminShell>
  )
}
