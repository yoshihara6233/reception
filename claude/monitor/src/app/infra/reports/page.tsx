/**
 * /infra/reports — 稼働率レポート一覧 (v4.0 で i18n 化)
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { getT } from '@/lib/i18n/server'

interface ReportRow {
  id: string
  store_id: string | null
  kind: 'daily' | 'weekly' | 'monthly'
  period_from: string
  period_to: string
  pdf_url: string | null
  generated_at: string | null
  sent_to_emails: string[] | null
  created_at: string
}
interface StoreRow { id: string; name: string }

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

export default async function InfraReportsPage() {
  const supa = await createSupabaseServer()
  const t = await getT()

  const [reportsRes, storesRes] = await Promise.all([
    supa.from('monitor_reports')
      .select('id, store_id, kind, period_from, period_to, pdf_url, generated_at, sent_to_emails, created_at')
      .order('period_from', { ascending: false })
      .limit(500),
    supa.from('stores').select('id, name').limit(10_000),
  ])

  const reports  = (reportsRes.data ?? []) as ReportRow[]
  const storeMap = new Map(((storesRes.data ?? []) as StoreRow[]).map((s) => [s.id, s.name]))

  const KIND_LABEL: Record<'daily' | 'weekly' | 'monthly', string> = {
    daily:   t.infraReports.kindDaily,
    weekly:  t.infraReports.kindWeekly,
    monthly: t.infraReports.kindMonthly,
  }

  return (
    <AdminShell pathname="/infra/reports" section="infra">
      <PageHeader
        title={t.infraReports.title}
        crumb={[
          { href: '/infra',         label: t.breadcrumb.infra },
          { href: '/infra/reports', label: t.breadcrumb.infraReports },
        ]}
      />
      <div className="space-y-4 p-5">
        {reports.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-gedink3">{t.infraReports.empty}</p>
        ) : (
          <div className="overflow-hidden rounded border border-slate-200 dark:border-gedline">
            <table className="min-w-full divide-y divide-slate-200 text-xs dark:divide-gedline">
              <thead className="bg-slate-50 dark:bg-gedbg3">
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 dark:text-gedink3">
                  <th className="px-3 py-1.5">{t.infraReports.colStore}</th>
                  <th className="px-3 py-1.5">{t.infraReports.colKind}</th>
                  <th className="px-3 py-1.5">{t.infraReports.colPeriod}</th>
                  <th className="px-3 py-1.5">{t.infraReports.colGenerated}</th>
                  <th className="px-3 py-1.5">{t.infraReports.colPdf}</th>
                  <th className="px-3 py-1.5">{t.infraReports.colEmails}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-gedline">
                {reports.map((r) => (
                  <tr key={r.id} className="text-slate-700 dark:text-gedink">
                    <td className="px-3 py-1.5">{r.store_id ? (storeMap.get(r.store_id) ?? t.common.dash) : t.common.dash}</td>
                    <td className="px-3 py-1.5">{KIND_LABEL[r.kind]}</td>
                    <td className="px-3 py-1.5 font-mono tabular-nums">
                      {fmtDay(r.period_from)} 〜 {fmtDay(r.period_to)}
                    </td>
                    <td className="px-3 py-1.5 font-mono tabular-nums">{fmtJst(r.generated_at)}</td>
                    <td className="px-3 py-1.5">
                      {r.pdf_url ? (
                        <a
                          href={r.pdf_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 underline hover:text-blue-800 dark:text-gedaccent"
                        >
                          {t.common.open}
                        </a>
                      ) : (
                        <span className="text-slate-400 dark:text-gedink3">{t.common.notGenerated}</span>
                      )}
                    </td>
                    <td className="max-w-xs truncate px-3 py-1.5 text-slate-500 dark:text-gedink3">
                      {r.sent_to_emails && r.sent_to_emails.length > 0
                        ? r.sent_to_emails.join(', ')
                        : t.common.dash}
                    </td>
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
