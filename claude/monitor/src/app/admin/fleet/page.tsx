import { redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { AdminDenied } from '@/components/admin/AdminDenied'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { resolveAdminContext } from '@/lib/tenant/acting'
import { getT } from '@/lib/i18n/server'
import { FleetClient, type FleetRow } from './fleet-client'

/**
 * 多拠点 統合ダッシュボード（HYBRID_PHASE1_OVERVIEW §5・B1）。
 * 既存 signal（heartbeat・health・OTA・設定反映・ライセンス）を横断集約し、
 * 「要対応の拠点」を1画面に。クラウドのみ（G・VMS 依頼なし）。
 * パートナー(tenant_admin)は自テナントのみ、Intereco は横断（RLS＋操作中テナント）。
 */
export const dynamic = 'force-dynamic'

const STALE_MS = 15 * 60_000

export default async function FleetPage() {
  const guard = await requireAdmin()
  if (!guard.ok) { if (guard.status === 401) redirect('/login'); return <AdminDenied pathname="/admin/fleet" /> }
  const t = await getT()
  const ctx = await resolveAdminContext(guard.supa)

  let storeQuery = guard.supa.from('stores').select('id, name, area_code').order('name').limit(1000)
  if (ctx.storeIds) storeQuery = storeQuery.in('id', ctx.storeIds)
  else if (ctx.tenantId) storeQuery = storeQuery.eq('tenant_id', ctx.tenantId)
  const { data: storeRows } = await storeQuery
  const stores = (storeRows ?? []) as { id: string; name: string; area_code: string | null }[]
  const storeName = new Map(stores.map((s) => [s.id, s.name]))
  const allowedIds = stores.map((s) => s.id)

  const rows: FleetRow[] = []
  const now = Date.now()
  if (allowedIds.length > 0) {
    const svc = createSupabaseService()
    // nvms アップリンクのエッジ（＝拠点）。
    const { data: edges } = await svc
      .from('edge_devices')
      .select('id, name, store_id, status, last_seen_at, agent_version, desired_agent_version, applied_config_version')
      .in('store_id', allowedIds)
      .like('agent_version', 'nvmsd/%')
      .order('name')
      .limit(1000)
    const edgeIds = (edges ?? []).map((e) => e.id as string)

    const recByEdge = new Map<string, { health: Record<string, unknown> | null; health_at: string | null; config_version: number }>()
    const camByEdge = new Map<string, number>()
    const licByEdge = new Map<string, { org: string | null; expires_at: string | null; status: string }>()
    if (edgeIds.length > 0) {
      const { data: recs } = await svc.from('recorders')
        .select('id, edge_id, health, health_at, config_version').eq('vendor', 'nvms').in('edge_id', edgeIds)
      const recIds: string[] = []
      const recEdge = new Map<string, string>()
      for (const r of recs ?? []) { recByEdge.set(r.edge_id as string, r as never); recIds.push(r.id as string); recEdge.set(r.id as string, r.edge_id as string) }
      if (recIds.length > 0) {
        const { data: cams } = await svc.from('recorder_cameras').select('recorder_id').in('recorder_id', recIds).limit(200000)
        for (const c of cams ?? []) { const e = recEdge.get(c.recorder_id as string); if (e) camByEdge.set(e, (camByEdge.get(e) ?? 0) + 1) }
      }
      const { data: lics } = await svc.from('licenses')
        .select('edge_id, org_name, expires_at, status').eq('status', 'active').in('edge_id', edgeIds)
      for (const l of lics ?? []) licByEdge.set(l.edge_id as string, { org: (l.org_name as string | null) ?? null, expires_at: (l.expires_at as string | null) ?? null, status: l.status as string })
    }

    for (const e of edges ?? []) {
      const rec = recByEdge.get(e.id as string)
      const h = rec?.health ?? null
      const err = h && typeof h.errors === 'object' && h.errors ? ((h.errors as Record<string, unknown>).count_24h as number | undefined) ?? 0 : 0
      const healthStale = !rec?.health_at || now - new Date(rec.health_at).getTime() > STALE_MS
      const seenStale = !e.last_seen_at || now - new Date(e.last_seen_at).getTime() > STALE_MS
      const running = (e.agent_version as string ?? '').replace(/^nvmsd\//, '')
      const desiredVer = e.desired_agent_version as string | null
      const verPending = !!desiredVer && running !== desiredVer
      const cfgVer = rec?.config_version ?? 0
      const cfgPending = cfgVer > 0 && (e.applied_config_version as number | null) !== cfgVer
      const lic = licByEdge.get(e.id as string) ?? null
      const licExpired = !!lic?.expires_at && new Date(lic.expires_at + 'T23:59:59+09:00').getTime() < now

      const attention =
        seenStale || (!healthStale && err > 0) || cfgPending || verPending || licExpired ||
        (!healthStale && ((h?.cameras_offline as number | undefined) ?? 0) > 0)

      rows.push({
        edgeId: e.id as string,
        store: storeName.get(e.store_id as string) ?? '—',
        name: (e.name as string) ?? '(無名)',
        status: e.status as string,
        seenStale, lastSeenAt: (e.last_seen_at as string | null) ?? null,
        camerasTotal: (h?.cameras_total as number | undefined) ?? camByEdge.get(e.id as string) ?? 0,
        camerasOffline: (h?.cameras_offline as number | undefined) ?? 0,
        nodesOk: (h?.nodes_ok as number | undefined) ?? null,
        nodesTotal: (h?.nodes_total as number | undefined) ?? null,
        errors24h: err, healthStale,
        diskDaysLeft: (h?.disk_days_left as number | undefined) ?? null,
        running: running || null, desiredVer, verPending,
        cfgState: cfgVer === 0 ? 'none' : cfgPending ? 'pending' : 'applied',
        licenseOrg: lic?.org ?? null, licenseExpires: lic?.expires_at ?? null, licenseExpired: licExpired,
        attention,
      })
    }
    // 要対応を上に。
    rows.sort((a, b) => Number(b.attention) - Number(a.attention))
  }

  return (
    <AdminShell pathname="/admin/fleet" section="admin">
      <PageHeader title="拠点稼働"
        crumb={[{ href: '/admin', label: t.breadcrumb.admin }, { href: '/admin/fleet', label: '拠点稼働' }]} />
      <div className="p-5">
        <FleetClient rows={rows} />
      </div>
    </AdminShell>
  )
}
