import { redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { AdminDenied } from '@/components/admin/AdminDenied'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { resolveAdminContext } from '@/lib/tenant/acting'
import { getT } from '@/lib/i18n/server'
import { LicensesClient, type LicRow, type EdgeOpt } from './licenses-client'

/**
 * ライセンスのクラウド管理（LICENSE_SPEC.md・第1弾 A4）。
 * パートナー（tenant_admin）が自テナントのライセンスを発行/差し替え/失効。
 * super_admin は横断。スコープは操作中テナント＋ RLS で担保（/admin/provisioning と同型）。
 */
export const dynamic = 'force-dynamic'

export default async function LicensesPage() {
  const guard = await requireAdmin()
  if (!guard.ok) { if (guard.status === 401) redirect('/login'); return <AdminDenied pathname="/admin/licenses" /> }
  const t = await getT()
  const ctx = await resolveAdminContext(guard.supa)

  // 見える店舗（操作中テナント＋RLS）。以降はこの store_id 群で絞る。
  let storeQuery = guard.supa.from('stores').select('id, name, area_code').order('name').limit(1000)
  if (ctx.storeIds) storeQuery = storeQuery.in('id', ctx.storeIds)
  else if (ctx.tenantId) storeQuery = storeQuery.eq('tenant_id', ctx.tenantId)
  const { data: storeRows } = await storeQuery
  const stores = (storeRows ?? []) as { id: string; name: string; area_code: string | null }[]
  const storeName = new Map(stores.map((s) => [s.id, s.name]))
  const allowedIds = stores.map((s) => s.id)
  const canIssue = !!ctx.tenantId || !!ctx.storeIds

  const edges: EdgeOpt[] = []
  const rows: LicRow[] = []
  if (allowedIds.length > 0) {
    const svc = createSupabaseService()
    // nvms アップリンクのエッジ（発行対象）。MAC・現在カメラ台数も出す。
    const { data: ed } = await svc
      .from('edge_devices')
      .select('id, name, store_id, agent_version, reported_mac')
      .in('store_id', allowedIds)
      .like('agent_version', 'nvmsd/%')
      .order('name')
      .limit(500)
    const edgeIds = (ed ?? []).map((e) => e.id as string)

    // エッジごとの現在カメラ台数（nvms レコーダの recorder_cameras 数）。
    const camByEdge = new Map<string, number>()
    if (edgeIds.length > 0) {
      const { data: recs } = await svc.from('recorders').select('id, edge_id').eq('vendor', 'nvms').in('edge_id', edgeIds)
      const recEdge = new Map((recs ?? []).map((r) => [r.id as string, r.edge_id as string]))
      const recIds = (recs ?? []).map((r) => r.id as string)
      if (recIds.length > 0) {
        const { data: cams } = await svc.from('recorder_cameras').select('recorder_id').in('recorder_id', recIds).limit(200000)
        for (const c of cams ?? []) {
          const e = recEdge.get(c.recorder_id as string); if (!e) continue
          camByEdge.set(e, (camByEdge.get(e) ?? 0) + 1)
        }
      }
    }
    for (const e of ed ?? []) {
      edges.push({ id: e.id as string, name: (e.name as string) ?? '(無名)', store: storeName.get(e.store_id as string) ?? '—',
        mac: (e.reported_mac as string | null) ?? null, cameras: camByEdge.get(e.id as string) ?? 0 })
    }

    const { data: lic } = await svc
      .from('licenses')
      .select('id, edge_id, store_id, org_name, max_cameras, expires_at, bound_mac, license_version, status, updated_at')
      .in('store_id', allowedIds)
      .order('created_at', { ascending: false })
      .limit(500)
    const edgeName = new Map(edges.map((e) => [e.id, e.name]))
    for (const l of lic ?? []) {
      rows.push({
        id: l.id as string, edgeId: l.edge_id as string,
        edge: edgeName.get(l.edge_id as string) ?? '(不明)',
        store: storeName.get(l.store_id as string) ?? '—',
        org: (l.org_name as string | null) ?? null,
        maxCameras: (l.max_cameras as number | null) ?? null,
        cameras: camByEdge.get(l.edge_id as string) ?? 0,
        expiresAt: (l.expires_at as string | null) ?? null,
        boundMac: (l.bound_mac as string | null) ?? null,
        version: l.license_version as number,
        status: l.status as 'active' | 'revoked',
      })
    }
  }

  return (
    <AdminShell pathname="/admin/licenses" section="admin">
      <PageHeader title="ライセンス"
        crumb={[{ href: '/admin', label: t.breadcrumb.admin }, { href: '/admin/licenses', label: 'ライセンス' }]} />
      <div className="p-5">
        <LicensesClient edges={edges} rows={rows} canIssue={canIssue} />
      </div>
    </AdminShell>
  )
}
