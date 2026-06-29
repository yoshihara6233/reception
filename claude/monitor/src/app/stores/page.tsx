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
import type { StoreDashRow, AlertRecord } from '@/components/StoresDashboard'
import { deriveEdgeStatus, isMonitoringDown } from '@/lib/edge-status'

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
  //
  // F107: 24 時間で自動的に消えるべきアラートが status だけで判定され、終端化
  // しないイベント (recording のまま放置された BCP テスト等) が永久に地図へ
  // 残る問題を修正。イベント系 (bcp_events / monitor_incidents / patrol_findings)
  // には「発生から 24 時間以内」の時間窓を追加する。edge_devices の offline/error
  // は『現在のライブ状態』なので時間制限しない (2 日前から落ちている拠点は今も
  // 障害中であり、消すべきではない)。
  const ALERT_WINDOW_HOURS = 24
  const alertCutoffIso = new Date(
    Date.now() - ALERT_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString()
  const safeQuery = async <T,>(
    label: string,
    p: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  ): Promise<T[]> => {
    try {
      const { data, error } = await p
      if (error) {
        console.warn(`[stores page] ${label} failed:`, error.message)
        return []
      }
      return data ?? []
    } catch (e: unknown) {
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

    safeQuery<{ store_id: string | null; opened_at: string | null }>(
      'monitor_incidents',
      supa
        .from('monitor_incidents')
        .select('store_id, opened_at')
        .in('status', ['open', 'ack'])
        .gte('opened_at', alertCutoffIso)   // F107: 24h window
        .limit(10_000) as unknown as PromiseLike<{
          data: { store_id: string | null; opened_at: string | null }[] | null
          error: { message: string } | null
        }>,
    ),

    // F27.1: bcp_events のクエリは `.not('status', 'in', ...)` が一部の Supabase
    // バージョンで構文エラーを返すため、2 つの .neq に分割する。
    safeQuery<{ store_id: string | null; status: string; alert_issued_at: string | null }>(
      'bcp_events',
      supa
        .from('bcp_events')
        .select('store_id, status, alert_issued_at')
        .neq('status', 'completed')
        .neq('status', 'failed')
        .gte('alert_issued_at', alertCutoffIso)   // F107: 24h window
        .limit(10_000) as unknown as PromiseLike<{
          data: { store_id: string | null; status: string; alert_issued_at: string | null }[] | null
          error: { message: string } | null
        }>,
    ),

    safeQuery<{ created_at: string | null; patrol_runs?: { store_id?: string } | { store_id?: string }[] }>(
      'patrol_findings',
      supa
        .from('patrol_findings')
        .select('created_at, patrol_runs!inner(store_id)')
        .in('status', ['anomaly', 'review'])
        .gte('created_at', alertCutoffIso)   // F107: 24h window
        .limit(10_000) as unknown as PromiseLike<{
          data: { created_at: string | null; patrol_runs?: { store_id?: string } | { store_id?: string }[] }[] | null
          error: { message: string } | null
        }>,
    ),
  ])

  const stores = storesData

  // F108: per-alert レコードを組み立てる。従来は store_id を Set に潰して種別を
  // 失っていたため、bottom-sheet が全アラートを「オフライン」と誤表示していた。
  // 1 アラート = 1 レコードとし、種別 (kind) と発生時刻 (occurredAt) を保持する。
  const storeById = new Map(stores.map((s) => [s.id, s]))
  const nameOf = (storeId: string | null | undefined): string =>
    (storeId && storeById.get(storeId)?.name) || '—'

  const alerts: AlertRecord[] = []

  // 1) 監視中断 / エラー (ライブ状態。24h 窓は適用しない)
  //    TC3: last_seen 鮮度を真実源に派生。status='grid' のまま固着して無応答の
  //    エッジ（クラッシュ/回線断）も interrupted として確実にアラート化する。
  //    未設置(unconfigured)・正常監視中(monitoring) はアラートにしない。
  stores.forEach((s) => {
    const dev = s.edge_devices?.[0]
    const d   = deriveEdgeStatus(dev?.status, dev?.last_seen_at)
    if (d.plane === 'monitoring' && d.mode === 'error') {
      alerts.push({ storeId: s.id, storeName: s.name, kind: 'edge_error',
        occurredAt: dev?.last_seen_at ?? null, href: `/stores/${s.id}` })
    } else if (isMonitoringDown(d)) {
      alerts.push({ storeId: s.id, storeName: s.name, kind: 'edge_offline',
        occurredAt: dev?.last_seen_at ?? null, href: `/stores/${s.id}` })
    }
  })
  // 2) monitor_incidents → /infra/incidents
  incidentsData.forEach((r) => {
    if (r.store_id) alerts.push({ storeId: r.store_id, storeName: nameOf(r.store_id),
      kind: 'incident', occurredAt: r.opened_at ?? null, href: '/infra/incidents' })
  })
  // 3) bcp_events → /bcp
  bcpData.forEach((r) => {
    if (r.store_id) alerts.push({ storeId: r.store_id, storeName: nameOf(r.store_id),
      kind: 'bcp', occurredAt: r.alert_issued_at ?? null, href: '/bcp' })
  })
  // 4) patrol_findings (joined through patrol_runs) → /security
  findingsData.forEach((r) => {
    const pr = Array.isArray(r.patrol_runs) ? r.patrol_runs[0] : r.patrol_runs
    if (pr?.store_id) alerts.push({ storeId: pr.store_id, storeName: nameOf(pr.store_id),
      kind: 'patrol', occurredAt: r.created_at ?? null, href: '/security' })
  })

  // 新しい順 (occurredAt 降順、null は末尾)
  alerts.sort((a, b) => (b.occurredAt ?? '').localeCompare(a.occurredAt ?? ''))

  return (
    <AppShell showDetail={false}>
      <StoresDashboard stores={stores} alerts={alerts} />
    </AppShell>
  )
}
