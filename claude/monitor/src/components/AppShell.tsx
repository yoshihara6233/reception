/**
 * The app chrome shared by all authenticated pages.
 *
 * Desktop (md+):  3-column grid — StoreTree | content | StoreDetail
 * Mobile:         Full-width content + bottom nav + slide-in StoreDrawer
 */
import { redirect } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { resolveTenantFeatures } from '@/lib/tenant/features'
import { resolveAdminContext } from '@/lib/tenant/acting'
import { AppHeader } from './AppHeader'
import { StoreTree } from './StoreTree'
import { StoreDetail } from './StoreDetail'
import { StatusBar } from './StatusBar'
import { BottomNav } from './BottomNav'
import { AppShellClient } from './AppShellClient'
import { ShellBody } from './ShellBody'

export async function AppShell({
  selectedStoreId,
  showDetail = true,
  children,
}: {
  selectedStoreId?: string
  showDetail?: boolean
  children: React.ReactNode
}) {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) redirect('/login')

  const userName = user.user_metadata?.name ?? user.email ?? '不明'

  // テナントのオプション機能（巡回/発報/検査）を解決してヘッダーの出し分けに使う。
  const features = await resolveTenantFeatures(supa)

  // 可視店舗をロールで絞る: 店舗マネージャ等は担当店舗のみ／tenant_admin はテナント／
  // super_admin は全店舗（操作中テナント選択時はそのテナント）。
  const ctx = await resolveAdminContext(supa)

  // Fetch store groups + recent BCP alert store IDs in parallel
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  let storesQuery = supa
    .from('stores')
    .select('id, name, area_code, edge_devices ( status, last_seen_at )')
    .order('area_code', { ascending: true, nullsFirst: false })
    .order('name')
    .limit(10_000)
  if (ctx.storeIds) storesQuery = storesQuery.in('id', ctx.storeIds)
  else if (ctx.tenantId) storesQuery = storesQuery.eq('tenant_id', ctx.tenantId)

  const [storeRes, alertRes] = await Promise.all([
    storesQuery,
    supa
      .from('bcp_events')
      .select('store_id')
      .gte('created_at', since24h)
      .not('store_id', 'is', null),
  ])

  const byArea = new Map<string, { id: string; name: string; area_code: string | null; edge_devices: { status: string; last_seen_at: string | null }[] | null }[]>()
  for (const s of (storeRes.data ?? []) as { id: string; name: string; area_code: string | null; edge_devices: { status: string; last_seen_at: string | null }[] | null }[]) {
    const a = s.area_code ?? '未分類'
    if (!byArea.has(a)) byArea.set(a, [])
    byArea.get(a)!.push(s)
  }
  const groups = [...byArea.entries()].map(([area, stores]) => ({ area, stores }))

  // Deduplicated store IDs that received a BCP alert in the last 24 h
  const alertStoreIds = [
    ...new Set(
      (alertRes.data ?? [])
        .map((e: { store_id: string | null }) => e.store_id)
        .filter((id): id is string => id !== null)
    ),
  ]

  return (
    // AppShellClient manages the drawer open/close state
    <AppShellClient
      userName={userName}
      groups={groups}
      selectedStoreId={selectedStoreId}
      features={features}
    >
      {/* Desktop 3-col layout with a collapsible detail panel (ShellBody) */}
      <ShellBody
        tree={<StoreTree selectedId={selectedStoreId} groups={groups} alertStoreIds={alertStoreIds} />}
        content={children}
        detail={showDetail && selectedStoreId ? <StoreDetail storeId={selectedStoreId} /> : null}
      />

      {/* Status bar: desktop only (too small for mobile) */}
      <div className="hidden md:block">
        <StatusBar />
      </div>
    </AppShellClient>
  )
}
