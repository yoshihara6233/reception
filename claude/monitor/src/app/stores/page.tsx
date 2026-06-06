/**
 * /stores — Home dashboard for authenticated users.
 *
 * Desktop: AppShell 3-col (StoreTree | StoresDashboard | —)
 * Mobile:  Full-width StoresDashboard with tab switching:
 *            • 店舗ビュー  — KPI strip + area-grouped store list
 *            • 地図+アラート — Leaflet map + bottom-sheet alerts
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AppShell } from '@/components/AppShell'
import { StoresDashboard } from '@/components/StoresDashboard'
import type { StoreDashRow } from '@/components/StoresDashboard'

export default async function StoresIndex() {
  const supa = await createSupabaseServer()

  // F27: "アラート" の定義を拡張する。従来は edge_devices.status だけだったが、
  // 「直近アラート対象」とは下記いずれかに該当する店舗:
  //   - edge_devices.status が offline / error
  //   - monitor_incidents.status が open / ack（インフラ系インシデント）
  //   - bcp_events.status が active 系（completed / failed 以外）
  //   - patrol_findings.status が anomaly / review（セキュリティ系検出）
  //
  // F27.1: テナントのスキーマ／migration 状態が異なる場合に 1 つのクエリ失敗で
  // ページ全体が 500 にならないよう、各クエリを try/catch でくるんで [] に
  // フォールバック。サーバログに失敗内容だけ出す。
  const safeQuery = async <T,>(
    label: string,
    p: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ): Promise<T[]> => {
    try {
      const { data, error } = await p
      if (error) {
        // eslint-disable-next-line no-console
        console.warn(`[stores page] ${label} failed:`, error.message)
        return []
      }
      return data ?? []
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.warn(`[stores page] ${label} threw:`, (e as Error).message)
      return []
    }
  }

  const [storesData, incidentsData, bcpData, findingsData] = await Promise.all([
    safeQuery<StoreDashRow>(
      'stores',
      supa
        .from('stores')
        .select(`
          id, name, address, latitude, longitude, area_code,
          edge_devices ( id, status, last_seen_at )
        `)
        .order('area_code', { ascending: true, nullsFirst: false })
        .order('name')
        .limit(10_000) as unknown as PromiseLike<{
          data: StoreDashRow[] | null
          error: { message: string } | null
        }>,
    ),

    safeQuery<{ store_id: string | null }>(
      'monitor_incidents',
      supa
        .from('monitor_incidents')
        .select('store_id')
        .in('status', ['open', 'ack'])
        .limit(10_000) as unknown as PromiseLike<{
          data: { store_id: string | null }[] | null
          error: { message: string } | null
        }>,
    ),

    // F27.1: bcp_events のクエリは `.not('status', 'in', ...)` が一部の Supabase
    // バージョンで構文エラーを返すため、2 つの .neq に分割する。
    safeQuery<{ store_id: string | null; status: string }>(
      'bcp_events',
      supa
        .from('bcp_events')
        .select('store_id, status')
        .neq('status', 'completed')
        .neq('status', 'failed')
        .limit(10_000) as unknown as PromiseLike<{
          data: { store_id: string | null; status: string }[] | null
          error: { message: string } | null
        }>,
    ),

    safeQuery<{ patrol_runs?: { store_id?: string } | { store_id?: string }[] }>(
      'patrol_findings',
      supa
        .from('patrol_findings')
        .select('patrol_runs!inner(store_id)')
        .in('status', ['anomaly', 'review'])
        .limit(10_000) as unknown as PromiseLike<{
          data: { patrol_runs?: { store_id?: string } | { store_id?: string }[] }[] | null
          error: { message: string } | null
        }>,
    ),
  ])

  const stores = storesData

  const alertStoreIds = new Set<string>()
  // 1) edge offline / error
  stores.forEach((s) => {
    const st = s.edge_devices?.[0]?.status
    if (st === 'offline' || st === 'error') alertStoreIds.add(s.id)
  })
  // 2) monitor_incidents
  incidentsData.forEach((r) => {
    if (r.store_id) alertStoreIds.add(r.store_id)
  })
  // 3) bcp_events
  bcpData.forEach((r) => {
    if (r.store_id) alertStoreIds.add(r.store_id)
  })
  // 4) patrol_findings (joined through patrol_runs)
  findingsData.forEach((r) => {
    const pr = Array.isArray(r.patrol_runs) ? r.patrol_runs[0] : r.patrol_runs
    if (pr?.store_id) alertStoreIds.add(pr.store_id)
  })

  return (
    <AppShell showDetail={false}>
      <StoresDashboard stores={stores} alertStoreIds={Array.from(alertStoreIds)} />
    </AppShell>
  )
}
