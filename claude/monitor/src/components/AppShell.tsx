/**
 * The app chrome shared by all authenticated pages.
 *
 * Desktop (md+):  3-column grid — StoreTree | content | StoreDetail
 * Mobile:         Full-width content + bottom nav + slide-in StoreDrawer
 */
import { redirect } from 'next/navigation'
import { getServerClient, getSessionUser } from '@/lib/tenant/session'
import { jmaIntensityLabel } from '@/lib/bcp/intensity'
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
  // 認証・admin_users・tenants は lib/tenant/session の cache() 済みヘルパ経由。
  // 以前はここと resolveTenantFeatures と resolveAdminContext が別々に取得していて、
  // 1クリックあたり auth.getUser()×4 / admin_users×2 / tenants×3 が直列に飛んでいた。
  const supa = await getServerClient()
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const userName = user.user_metadata?.name ?? user.email ?? '不明'

  // 発報アラートは可視店舗の絞り込み結果に依存しないので、先に投げて後で待つ。
  // PostgrestFilterBuilder は thenable で、then() が呼ばれるまで実際のリクエストは
  // 飛ばない（変数に入れただけでは走らない）。ここで明示的にプロミス化して先行させる。
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const alertPromise = supa
    .from('bcp_events')
    .select('store_id, alert_type, alert_issued_at, area_code, max_intensity, is_test')
    .gte('created_at', since24h)
    .not('store_id', 'is', null)
    .then((r) => r)

  // features（ヘッダーの出し分け）と ctx（可視店舗の絞り込み）は同じ素材を使うため、
  // cache() により実クエリは共有される。並列にしておけば待ち時間も重ならない。
  const [features, ctx] = await Promise.all([
    resolveTenantFeatures(),
    resolveAdminContext(),
  ])

  // 可視店舗をロールで絞る: 店舗マネージャ等は担当店舗のみ／tenant_admin はテナント／
  // super_admin は全店舗（操作中テナント選択時はそのテナント）。
  let storesQuery = supa
    .from('stores')
    .select('id, name, area_code, edge_devices ( status, last_seen_at )')
    .order('area_code', { ascending: true, nullsFirst: false })
    .order('name')
    .limit(10_000)
  if (ctx.storeIds) storesQuery = storesQuery.in('id', ctx.storeIds)
  else if (ctx.tenantId) storesQuery = storesQuery.eq('tenant_id', ctx.tenantId)

  const [storeRes, alertRes] = await Promise.all([storesQuery, alertPromise])

  const byArea = new Map<string, { id: string; name: string; area_code: string | null; edge_devices: { status: string; last_seen_at: string | null }[] | null }[]>()
  for (const s of (storeRes.data ?? []) as { id: string; name: string; area_code: string | null; edge_devices: { status: string; last_seen_at: string | null }[] | null }[]) {
    const a = s.area_code ?? '未分類'
    if (!byArea.has(a)) byArea.set(a, [])
    byArea.get(a)!.push(s)
  }
  const groups = [...byArea.entries()].map(([area, stores]) => ({ area, stores }))

  // Deduplicated store IDs that received a BCP alert in the last 24 h
  type AlertEventRow = {
    store_id: string | null
    alert_type: string
    alert_issued_at: string
    area_code: string | null
    max_intensity: string | null
    is_test: boolean
  }
  const alertEventRows = (alertRes.data ?? []) as AlertEventRow[]
  const alertStoreIds = [
    ...new Set(
      alertEventRows
        .map((e) => e.store_id)
        .filter((id): id is string => id !== null)
    ),
  ]

  // 地震単位のグループ (/bcp と同じ alert_type+alert_issued_at+area_code キー)。
  // 群発時に「どの地震の対象店舗か」をツリーで絞り込めるようにする。
  const quakeMap = new Map<string, { issuedAt: string; maxIntensity: string | null; isTest: boolean; storeIds: Set<string> }>()
  for (const e of alertEventRows) {
    if (!e.store_id) continue
    const key = `${e.alert_type}|${e.alert_issued_at}|${e.area_code ?? ''}`
    let g = quakeMap.get(key)
    if (!g) {
      g = { issuedAt: e.alert_issued_at, maxIntensity: e.max_intensity, isTest: e.is_test, storeIds: new Set() }
      quakeMap.set(key, g)
    }
    g.storeIds.add(e.store_id)
    if (!g.maxIntensity && e.max_intensity) g.maxIntensity = e.max_intensity
  }
  const fmtIssued = (iso: string) =>
    new Date(iso).toLocaleString('ja-JP', {
      timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  const alertGroups = [...quakeMap.entries()]
    .sort((a, b) => b[1].issuedAt.localeCompare(a[1].issuedAt))
    .map(([key, g]) => ({
      key,
      label: [
        fmtIssued(g.issuedAt),
        jmaIntensityLabel(g.maxIntensity),
        g.isTest ? 'テスト' : null,
      ].filter(Boolean).join(' '),
      storeIds: [...g.storeIds],
    }))

  return (
    // AppShellClient manages the drawer open/close state
    <AppShellClient
      userName={userName}
      groups={groups}
      selectedStoreId={selectedStoreId}
      features={features}
      tenantName={ctx.tenantName}
      isSuper={ctx.isSuper}
    >
      {/* Desktop 3-col layout with a collapsible detail panel (ShellBody) */}
      <ShellBody
        tree={<StoreTree selectedId={selectedStoreId} groups={groups} alertStoreIds={alertStoreIds} alertGroups={alertGroups} />}
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
