/**
 * /security — 警備トリアージ（横断異常キュー）
 *
 * 監視員が全拠点の巡回 finding を1リストで捌く。設計判断 D2（横断異常キュー）/
 * D3（積極的な「全拠点正常」状態）に基づく。AdminShell + PageHeader で /bcp と一貫。
 */
import Link from 'next/link'
import { Shield, Check } from 'lucide-react'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { SecurityTriageClient, type Finding } from './SecurityTriageClient'
import { getT } from '@/lib/i18n/server'

interface FindingRow {
  id: string
  snapshot_url: string | null
  diff_score: number | null
  status: string
  ai_status: string
  ai_verdict: string | null
  ai_reason: string | null
  ai_confidence: number | null
  created_at: string
  patrol_runs: { store_id: string; stores: { id: string; name: string } | null } | null
  recorder_cameras: { id: string; name: string } | null
}

interface StoreStatusRow {
  store_id: string
  last_run_at: string | null
  enabled: boolean
  stores: { id: string; name: string } | null
}

function fmtJST(iso: string) {
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default async function SecurityPage() {
  const supa = await createSupabaseServer()
  const t = await getT()
  const tSec = t.securityTriage

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayISO = todayStart.toISOString()

  const [findingsRes, runCountRes, coverageRes, settingsRes] = await Promise.all([
    // Unconfirmed findings across all sites — the triage queue
    supa
      .from('patrol_findings')
      .select(
        'id, snapshot_url, diff_score, status, ai_status, ai_verdict, ai_reason, ai_confidence, created_at, ' +
        'patrol_runs!inner ( store_id, stores ( id, name ) ), recorder_cameras ( id, name )'
      )
      .in('status', ['anomaly', 'review', 'pending'])
      .order('created_at', { ascending: false })
      .limit(200),

    // Today's patrol count
    supa.from('patrol_runs').select('id', { count: 'exact', head: true }).gte('started_at', todayISO),

    // AI coverage today: done vs total findings created today
    supa.from('patrol_findings').select('ai_status', { count: 'exact' }).gte('created_at', todayISO).limit(5000),

    // Enabled stores + last patrol time (for the all-clear state)
    supa
      .from('security_settings')
      .select('store_id, last_run_at, enabled, stores ( id, name )')
      .eq('enabled', true)
      .order('last_run_at', { ascending: false, nullsFirst: false })
      .limit(1000),
  ])

  const rows = (findingsRes.data ?? []) as unknown as FindingRow[]

  const findings: Finding[] = rows.map((r) => ({
    id: r.id,
    storeId: r.patrol_runs?.store_id ?? '',
    storeName: r.patrol_runs?.stores?.name ?? '—',
    cameraName: r.recorder_cameras?.name ?? '—',
    snapshotUrl: r.snapshot_url,
    diffScore: r.diff_score,
    status: r.status,
    aiStatus: r.ai_status,
    aiVerdict: r.ai_verdict,
    aiReason: r.ai_reason,
    aiConfidence: r.ai_confidence,
    createdAt: r.created_at,
  }))

  const todayRuns = runCountRes.count ?? 0
  const coverageRows = (coverageRes.data ?? []) as { ai_status: string }[]
  const coverageTotal = coverageRows.length
  const coverageDone = coverageRows.filter((c) => c.ai_status === 'done').length

  const stores = (settingsRes.data ?? []) as unknown as StoreStatusRow[]
  const unconfirmed = findings.filter((f) => f.status === 'anomaly' || f.status === 'review').length

  return (
    <AdminShell pathname="/security" section="security">
      <PageHeader
        title={tSec.title}
        crumb={[{ href: '/security', label: t.breadcrumb.security }]}
      />

      <div className="px-5 py-4 space-y-4">
        {/* F38: 警備トリアージ解説バナー */}
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/50 dark:bg-emerald-950/30">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"><Shield size={16} strokeWidth={1.5} aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                {t.securityHelp.title}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-emerald-800/90 dark:text-emerald-200/80">
                {t.securityHelp.body}
              </p>
              <Link
                href="/security/glossary"
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300"
              >
                {t.securityHelp.learnMore} →
              </Link>
            </div>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">{tSec.statRunsToday}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-gedink">{todayRuns.toLocaleString()}</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">{tSec.statUnconfirmed}</div>
            <div className={'mt-1 text-2xl font-bold tabular-nums ' + (unconfirmed > 0 ? 'text-red-600 dark:text-[#E87D74]' : 'text-slate-900 dark:text-gedink')}>
              {unconfirmed.toLocaleString()}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-gedline dark:bg-gedbg2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-gedink3">{tSec.statAiCoverage}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-gedink">
              {coverageDone}/{coverageTotal}
            </div>
          </div>
        </div>

        {findings.length > 0 ? (
          // Populated triage queue (client component handles select + status actions)
          <SecurityTriageClient findings={findings} />
        ) : (
          // D3: active "全拠点正常" state — distinguish "no anomalies" from "system stopped"
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-8 dark:border-emerald-900/50 dark:bg-emerald-950/30">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"><Check size={22} strokeWidth={1.5} aria-hidden /></span>
              <div>
                <p className="text-base font-bold text-emerald-800 dark:text-emerald-300">{tSec.allNormalTitle}</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400/80">
                  {tSec.allNormalBody}
                </p>
              </div>
            </div>

            {stores.length > 0 ? (
              <div className="mt-5 overflow-hidden rounded-lg border border-emerald-200 bg-white dark:border-gedline dark:bg-gedbg2">
                <table className="w-full text-xs">
                  <thead className="bg-emerald-50/60 text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:bg-gedbg3 dark:text-gedink3">
                    <tr>
                      <th className="px-3 py-2 text-left">{tSec.colStore}</th>
                      <th className="px-3 py-2 text-left">{tSec.colLastRun}</th>
                      <th className="px-3 py-2 text-left">{tSec.colStatus}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stores.map((s) => (
                      <tr key={s.store_id} className="border-t border-emerald-50 dark:border-gedline">
                        <td className="px-3 py-2 font-medium text-slate-800 dark:text-gedink">{s.stores?.name ?? t.common.dash}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-gedink2">
                          {s.last_run_at ? fmtJST(s.last_run_at) : <span className="text-amber-600 dark:text-[#E2A55A]">{tSec.waitingForPatrol}</span>}
                        </td>
                        <td className="px-3 py-2">
                          <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                            {tSec.statusNormal}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-5 text-xs text-emerald-700 dark:text-emerald-400">
                {tSec.noStoresYet}
                <Link href="/security/settings" className="ml-1 font-semibold underline">{tSec.noStoresSettingsLink}</Link>
              </p>
            )}
          </div>
        )}
      </div>
    </AdminShell>
  )
}
