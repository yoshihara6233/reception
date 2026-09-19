import { redirect } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { AdminDenied } from '@/components/admin/AdminDenied'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { resolveAdminContext } from '@/lib/tenant/acting'
import { getT } from '@/lib/i18n/server'
import { ProvisioningClient, type ProvRow } from './provisioning-client'

/**
 * 拠点導入（エンロール）＋遠隔支援（NVMS/docs/ENROLLMENT_SPEC.md）。
 *
 * パートナー（tenant_admin）が自テナントの店舗にコードを発行し、現地の
 * 立ち上がりをここで追う。Intereco（super_admin）は全テナントを俯瞰。
 * スコープは guard.supa（RLS）で見える店舗に限定 → その store_id 群でだけ
 * enrollment_tokens（RLS 無し・service）を引く。
 */
export const dynamic = 'force-dynamic'

const STAGES = 6

export default async function ProvisioningPage() {
  const guard = await requireAdmin()
  if (!guard.ok) { if (guard.status === 401) redirect('/login'); return <AdminDenied pathname="/admin/provisioning" /> }
  const t = await getT()

  // テナント文脈（他の①設定ページと同じ「操作中テナント方式」）。
  // super_admin=操作中テナント / tenant_admin=自テナント / 店舗ロール=担当店舗。
  // これで絞らないと super_admin の店舗一覧に全テナントが出てしまう。
  const ctx = await resolveAdminContext(guard.supa)

  // 見える店舗。RLS に加えてテナント文脈でも絞る（表示と発行対象の両方）。
  let storeQuery = guard.supa
    .from('stores').select('id, name, area_code').order('name').limit(1000)
  if (ctx.storeIds) storeQuery = storeQuery.in('id', ctx.storeIds)
  else if (ctx.tenantId) storeQuery = storeQuery.eq('tenant_id', ctx.tenantId)
  const { data: storeRows } = await storeQuery
  const stores = (storeRows ?? []) as { id: string; name: string; area_code: string | null }[]
  // 発行はテナント文脈が確定している時のみ（super_admin 未選択で他テナントへ
  // 誤発行する事故を防ぐ。店舗ページの「新規作成はテナント確定時のみ」と同じ）。
  const canIssue = !!ctx.tenantId || !!ctx.storeIds
  const storeName = new Map(stores.map((s) => [s.id, s.name]))
  const allowedIds = stores.map((s) => s.id)

  const rows: ProvRow[] = []
  if (allowedIds.length > 0) {
    const svc = createSupabaseService()
    const { data: enrolls } = await svc
      .from('enrollment_tokens')
      .select('id, name, store_id, kind, used_at, edge_id, expires_at, created_at')
      .eq('kind', 'nvms')
      .in('store_id', allowedIds)
      .order('created_at', { ascending: false })
      .limit(50)
    const list = enrolls ?? []

    const edgeIds = list.map((e) => e.edge_id).filter((x): x is string => !!x)
    const edgeById = new Map<string, { status: string | null; last_seen_at: string | null; agent_version: string | null }>()
    const recByEdge = new Map<string, { id: string; health: Record<string, unknown> | null; health_at: string | null }>()
    const camByRec = new Map<string, number>()
    if (edgeIds.length > 0) {
      const { data: edges } = await svc
        .from('edge_devices').select('id, status, last_seen_at, agent_version').in('id', edgeIds)
      for (const e of edges ?? []) edgeById.set(e.id as string, e as never)

      const { data: recs } = await svc
        .from('recorders').select('id, edge_id, health, health_at').eq('vendor', 'nvms').in('edge_id', edgeIds)
      const recIds = (recs ?? []).map((r) => r.id as string)
      for (const r of recs ?? []) recByEdge.set(r.edge_id as string, r as never)

      if (recIds.length > 0) {
        const { data: cams } = await svc
          .from('recorder_cameras').select('recorder_id').in('recorder_id', recIds).limit(200_000)
        for (const c of cams ?? []) {
          const k = c.recorder_id as string
          camByRec.set(k, (camByRec.get(k) ?? 0) + 1)
        }
      }
    }

    const STALE_MS = 15 * 60_000
    const now = Date.now()
    for (const e of list) {
      const edge = e.edge_id ? edgeById.get(e.edge_id) : undefined
      const rec = e.edge_id ? recByEdge.get(e.edge_id) : undefined
      const health = rec?.health ?? null
      const healthFresh = !!rec?.health_at && now - new Date(rec.health_at).getTime() < STALE_MS
      const cameras = rec ? (camByRec.get(rec.id) ?? 0) : 0
      const heartbeat = !!edge?.last_seen_at

      // 段階: ①発行 ②claim ③heartbeat ④同期 ⑤health ⑥完了
      let stage = 1
      if (e.used_at) stage = 2
      if (heartbeat) stage = 3
      if (heartbeat && cameras > 0) stage = 4
      if (heartbeat && cameras > 0 && healthFresh) stage = 5
      if (stage === 5) stage = 6 // health まで揃えば完了扱い

      rows.push({
        id: e.id,
        name: e.name,
        storeName: storeName.get(e.store_id) ?? '—',
        stage,
        stages: STAGES,
        used: !!e.used_at,
        expiresAt: e.expires_at,
        edgeId: e.edge_id,
        runningVersion: (edge?.agent_version ?? '').replace(/^nvmsd\//, '') || null,
        cameras,
        nodesOk: (health?.nodes_ok as number | undefined) ?? null,
        nodesTotal: (health?.nodes_total as number | undefined) ?? null,
        errors24h: (health && typeof health.errors === 'object' && health.errors
          ? ((health.errors as Record<string, unknown>).count_24h as number | undefined) : undefined) ?? null,
        healthFresh,
      })
    }
  }

  return (
    <AdminShell pathname="/admin/provisioning" section="admin">
      <PageHeader
        title="拠点導入"
        crumb={[{ href: '/admin', label: t.breadcrumb.admin }, { href: '/admin/provisioning', label: '拠点導入' }]}
      />
      <div className="p-5">
        <ProvisioningClient stores={stores} rows={rows} canIssue={canIssue} />
      </div>
    </AdminShell>
  )
}
