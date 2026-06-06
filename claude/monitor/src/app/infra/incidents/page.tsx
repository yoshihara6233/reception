/**
 * /infra/incidents — インシデント一覧
 *
 * monitor_incidents を 状態別 (open / ack / resolved) にカテゴライズして表示。
 * テナントスコープは RLS で自動適用。 v4.0 で全文 i18n 化（4 言語切替対応）。
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { getT } from '@/lib/i18n/server'
import type { Msg } from '@/lib/i18n/messages'

interface IncidentRow {
  id: string
  store_id: string | null
  target_type: 'edge' | 'recorder' | 'camera' | 'tenant'
  target_id: string | null
  kind: string
  severity: 'info' | 'warn' | 'danger'
  status: 'open' | 'ack' | 'resolved'
  detail: string | null
  opened_at: string
  resolved_at: string | null
}
interface StoreRow { id: string; name: string }

const SEVERITY_COLOR = {
  info:   '#2C4A7E',
  warn:   '#B5761A',
  danger: '#A3332B',
} as const

function fmtJst(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default async function InfraIncidentsPage() {
  const supa = await createSupabaseServer()
  const t = await getT()

  const [incidentsRes, storesRes] = await Promise.all([
    supa.from('monitor_incidents')
      .select('id, store_id, target_type, target_id, kind, severity, status, detail, opened_at, resolved_at')
      .order('opened_at', { ascending: false })
      .limit(500),
    supa.from('stores').select('id, name').limit(10_000),
  ])

  const incidents = (incidentsRes.data ?? []) as IncidentRow[]
  const storeMap = new Map(((storesRes.data ?? []) as StoreRow[]).map((s) => [s.id, s.name]))

  const open     = incidents.filter((i) => i.status === 'open')
  const ack      = incidents.filter((i) => i.status === 'ack')
  const resolved = incidents.filter((i) => i.status === 'resolved')

  const STATUS_LABEL: Record<'open' | 'ack' | 'resolved', string> = {
    open:     t.infraIncidents.statusOpen,
    ack:      t.infraIncidents.statusAck,
    resolved: t.infraIncidents.statusResolved,
  }
  const SEVERITY_LABEL: Record<'info' | 'warn' | 'danger', string> = {
    info:   t.infraIncidents.severityInfo,
    warn:   t.infraIncidents.severityWarn,
    danger: t.infraIncidents.severityDanger,
  }

  return (
    <AdminShell pathname="/infra/incidents" section="infra">
      <PageHeader
        title={t.infraIncidents.title}
        crumb={[
          { href: '/infra',           label: t.breadcrumb.infra },
          { href: '/infra/incidents', label: t.breadcrumb.infraIncidents },
        ]}
      />
      <div className="space-y-6 p-5">
        <Section t={t} title={t.infraIncidents.sectionOpen(open.length)}     rows={open}     storeMap={storeMap} emptyText={t.infraIncidents.emptyOpen} STATUS_LABEL={STATUS_LABEL} SEVERITY_LABEL={SEVERITY_LABEL} />
        <Section t={t} title={t.infraIncidents.sectionAck(ack.length)}       rows={ack}      storeMap={storeMap} emptyText={t.infraIncidents.emptyAck}  STATUS_LABEL={STATUS_LABEL} SEVERITY_LABEL={SEVERITY_LABEL} />
        <Section t={t} title={t.infraIncidents.sectionResolved(Math.min(resolved.length, 100))} rows={resolved.slice(0, 100)} storeMap={storeMap} emptyText={t.infraIncidents.emptyResolved} STATUS_LABEL={STATUS_LABEL} SEVERITY_LABEL={SEVERITY_LABEL} />
      </div>
    </AdminShell>
  )
}

function Section({
  t, title, rows, storeMap, emptyText, STATUS_LABEL, SEVERITY_LABEL,
}: {
  t: Msg
  title: string
  rows: IncidentRow[]
  storeMap: Map<string, string>
  emptyText: string
  STATUS_LABEL: Record<'open' | 'ack' | 'resolved', string>
  SEVERITY_LABEL: Record<'info' | 'warn' | 'danger', string>
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-gedink2">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-gedink3">{emptyText}</p>
      ) : (
        <div className="overflow-hidden rounded border border-slate-200 dark:border-gedline">
          <table className="min-w-full divide-y divide-slate-200 text-xs dark:divide-gedline">
            <thead className="bg-slate-50 dark:bg-gedbg3">
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500 dark:text-gedink3">
                <th className="px-3 py-1.5">{t.infraIncidents.colTime}</th>
                <th className="px-3 py-1.5">{t.infraIncidents.colStore}</th>
                <th className="px-3 py-1.5">{t.infraIncidents.colTarget}</th>
                <th className="px-3 py-1.5">{t.infraIncidents.colKind}</th>
                <th className="px-3 py-1.5">{t.infraIncidents.colSeverity}</th>
                <th className="px-3 py-1.5">{t.infraIncidents.colStatus}</th>
                <th className="px-3 py-1.5">{t.infraIncidents.colDetail}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gedline">
              {rows.map((i) => (
                <tr key={i.id} className="text-slate-700 dark:text-gedink">
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums">{fmtJst(i.opened_at)}</td>
                  <td className="px-3 py-1.5">{i.store_id ? (storeMap.get(i.store_id) ?? t.common.dash) : t.infraIncidents.tenantLabel}</td>
                  <td className="px-3 py-1.5 capitalize">{i.target_type}</td>
                  <td className="px-3 py-1.5 font-mono">{i.kind}</td>
                  <td className="px-3 py-1.5">
                    <span
                      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                      style={{ background: SEVERITY_COLOR[i.severity] }}
                    >
                      {SEVERITY_LABEL[i.severity]}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">{STATUS_LABEL[i.status]}</td>
                  <td className="max-w-md truncate px-3 py-1.5 text-slate-500 dark:text-gedink3">{i.detail ?? t.common.dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
