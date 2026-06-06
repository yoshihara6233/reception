/**
 * /bcp — BCP イベント + レポート 統合ビュー (F42)
 *
 * 以前は `?tab=events` と `?tab=reports` の 2 タブで同じデータを別角度で
 * 表示していたが冗長だったため統合。今は:
 *   - 上部 = 統計カード (累計イベント / 生成済レポート / PDF配信済)
 *   - 下部 = アラート → 店舗 のツリービュー、各店舗行に PDF ボタン
 * 1 画面で BCP の全貌を把握できる。
 */
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader, LinkBtn } from '@/components/admin/PageHeader'
import { getT } from '@/lib/i18n/server'
import { EventsTreeTable, type BcpEventChild, type BcpReportLite } from './EventsTreeTable'

interface BcpEventRow {
  id: string
  alert_type: string
  alert_issued_at: string
  area_code: string | null
  status: string
  is_test: boolean
  created_at: string
  stores: { id: string; name: string } | null
}

interface ReportRow {
  id:             string
  event_id:       string
  pdf_url:        string | null
  generated_at:   string | null
  sent_to_emails: string[] | null
}

export default async function BcpPage() {
  const supa = await createSupabaseServer()
  const t    = await getT()
  const tBcp = t.bcpDashboard

  // F42: fetch events + reports + total-count in parallel (no more tab branching)
  const [eventsRes, reportsRes, totalRes] = await Promise.all([
    supa
      .from('bcp_events')
      .select('id, alert_type, alert_issued_at, area_code, status, is_test, created_at, stores ( id, name )')
      .order('created_at', { ascending: false })
      .limit(500),
    supa
      .from('bcp_reports')
      .select('id, event_id, pdf_url, generated_at, sent_to_emails')
      .order('created_at', { ascending: false })
      .limit(500),
    supa.from('bcp_events').select('id', { count: 'exact', head: true }),
  ])

  const eventRows  = (eventsRes.data  ?? []) as unknown as BcpEventRow[]
  const reportRows = (reportsRes.data ?? []) as unknown as ReportRow[]
  const totalEvents = totalRes.count ?? 0
  const generatedReports = reportRows.filter((r) => !!r.pdf_url).length
  const deliveredReports = reportRows.filter((r) => r.sent_to_emails && r.sent_to_emails.length > 0).length

  return (
    <AdminShell pathname="/bcp" section="bcp">
      <PageHeader
        title={tBcp.title}
        crumb={[{ href: '/bcp', label: t.breadcrumb.bcp }]}
        actions={<LinkBtn href="/bcp/test">{tBcp.testIssueBtn}</LinkBtn>}
      />

      <div className="px-5 py-4 space-y-4">

        {/* F36: J-Alert フロー解説バナー */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-900/50 dark:bg-blue-950/30">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-base dark:bg-blue-900/40">🚨</span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-blue-900 dark:text-blue-200">
                {t.bcpHelp.title}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-blue-800/90 dark:text-blue-200/80">
                {t.bcpHelp.body}
              </p>
              <Link
                href="/bcp/glossary"
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300"
              >
                {t.bcpHelp.learnMore} →
              </Link>
            </div>
          </div>
        </div>

        {/* F42: 統計カード — 旧 Reports タブから持ち越し */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tBcp.statTotal}</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{totalEvents.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tBcp.statGeneratedReports}</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{generatedReports.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{tBcp.statPdfDelivered}</div>
            <div className="mt-1 text-2xl font-bold text-emerald-700">{deliveredReports.toLocaleString()}</div>
          </div>
        </div>

        {/* F42: アラート→店舗ツリー (各子行に PDF リンク + 詳細) */}
        <EventsTreeTable
          rows={eventRows.map<BcpEventChild>((r) => ({
            id:               r.id,
            status:           r.status,
            is_test:          r.is_test,
            alert_issued_at:  r.alert_issued_at,
            alert_type:       r.alert_type,
            area_code:        r.area_code,
            store_id:         r.stores?.id ?? null,
            store_name:       r.stores?.name ?? null,
          }))}
          reports={reportRows.map<BcpReportLite>((r) => ({
            event_id:       r.event_id,
            pdf_url:        r.pdf_url,
            sent_to_emails: r.sent_to_emails,
          }))}
        />
      </div>
    </AdminShell>
  )
}
