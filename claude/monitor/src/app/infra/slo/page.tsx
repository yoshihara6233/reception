/**
 * F50.E: /infra/slo — SLO ダッシュボード
 *
 * Tier 3 中央集約モードの稼働品質指標を可視化。
 *
 * 計算ソース:
 *   - monitor_heartbeats から「過去 24h の死活成功率」
 *   - pending_commands から「過去 24h のコマンド成功率」
 *   - central_nodes から「ノード稼働率 (lease 有効率)」
 *
 * SLO ターゲット:
 *   - 死活監視成功率   ≥ 99%
 *   - コマンド成功率   ≥ 99.5%
 *   - ノード稼働率     ≥ 99.9%
 *   - p95 latency      ≤ 2.0s
 *
 * Phase 3: 後で Prometheus + Grafana に統合する想定だが、それまでは
 * Supabase に書き溜めたメトリクスから直接計算する。
 */
import { BarChart3 } from 'lucide-react'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'

interface SloMetric {
  name:       string
  target:     number     // 0.995 = 99.5%
  actual:     number | null
  unit:       '%' | 'ms' | 's'
  inverted?:  boolean    // 小さい方が良い (latency 等) なら true
  detail?:    string
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(2)}%`
}

function statusFor(actual: number | null, target: number, inverted = false): {
  label:  string
  color:  string
} {
  if (actual === null) return { label: 'データなし', color: 'bg-slate-200 text-slate-600' }
  const ok = inverted ? actual <= target : actual >= target
  if (ok) return { label: '達成', color: 'bg-emerald-100 text-emerald-700' }
  // 違反度に応じて
  const ratio = inverted ? target / actual : actual / target
  if (ratio > 0.99) return { label: 'ボーダー', color: 'bg-yellow-100 text-yellow-700' }
  return { label: '違反', color: 'bg-red-100 text-red-700' }
}

export default async function SloDashboard() {
  const supa = await createSupabaseServer()
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // ── 1. 死活監視成功率 (過去 24h) ────────────────────────────────────────
  let heartbeatSuccessRate: number | null = null
  let totalHb = 0; let okHb = 0
  try {
    const { data, error } = await supa
      .from('monitor_heartbeats')
      .select('reachable')
      .gte('recorded_at', since24h)
    if (!error && data) {
      const rows = data as Array<{ reachable: boolean }>
      totalHb = rows.length
      okHb = rows.filter((r) => r.reachable).length
      if (totalHb > 0) heartbeatSuccessRate = okHb / totalHb
    }
  } catch { /* テーブル未設定 */ }

  // ── 2. コマンド成功率 (過去 24h) ────────────────────────────────────────
  let commandSuccessRate: number | null = null
  let totalCmd = 0; let okCmd = 0
  try {
    const { data, error } = await supa
      .from('pending_commands')
      .select('status')
      .gte('created_at', since24h)
      .in('status', ['completed', 'failed'])
    if (!error && data) {
      const rows = data as Array<{ status: string }>
      totalCmd = rows.length
      okCmd = rows.filter((r) => r.status === 'completed').length
      if (totalCmd > 0) commandSuccessRate = okCmd / totalCmd
    }
  } catch { /* テーブル未存在 */ }

  // ── 3. ノード稼働率 (lease 有効性) ──────────────────────────────────────
  let nodeUptime: number | null = null
  try {
    const { data } = await supa
      .from('central_nodes')
      .select('id, status, lease_held_until')
    if (data && data.length > 0) {
      const rows = data as Array<{ status: string; lease_held_until: string | null }>
      const healthy = rows.filter((r) => {
        if (r.status === 'down' || r.status === 'draining') return false
        if (!r.lease_held_until) return false
        return new Date(r.lease_held_until) > new Date()
      }).length
      nodeUptime = healthy / rows.length
    }
  } catch { /* central_nodes 未設定 */ }

  // ── SLO リスト ──────────────────────────────────────────────────────────
  const slos: SloMetric[] = [
    {
      name:    '死活監視成功率',
      target:  0.99,
      actual:  heartbeatSuccessRate,
      unit:    '%',
      detail:  totalHb > 0 ? `直近 24h: ${okHb} / ${totalHb} 回成功` : 'まだデータがありません',
    },
    {
      name:    'コマンド成功率',
      target:  0.995,
      actual:  commandSuccessRate,
      unit:    '%',
      detail:  totalCmd > 0 ? `直近 24h: ${okCmd} / ${totalCmd} 件成功` : 'コマンド実行履歴なし',
    },
    {
      name:    'ノード稼働率',
      target:  0.999,
      actual:  nodeUptime,
      unit:    '%',
      detail:  nodeUptime !== null ? `${(nodeUptime * 100).toFixed(2)}% のノードが lease 有効` : 'ノード未登録',
    },
  ]

  return (
    <AdminShell pathname="/infra/slo" section="infra">
      <PageHeader
        title="SLO ダッシュボード"
        crumb={[
          { href: '/infra',     label: 'インフラ' },
          { href: '/infra/slo', label: 'SLO' },
        ]}
      />

      <div className="px-5 py-4 space-y-4">
        {/* SLO サマリ */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {slos.map((s) => {
            const status = statusFor(s.actual, s.target, s.inverted)
            return (
              <div key={s.name} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
                <div className="flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{s.name}</h3>
                  <span className={'rounded px-2 py-0.5 text-[11px] font-semibold ' + status.color}>
                    {status.label}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <div className={
                    'text-3xl font-bold tabular-nums ' +
                    (s.actual === null ? 'text-slate-300 dark:text-slate-600' : 'text-slate-900 dark:text-slate-100')
                  }>
                    {s.actual === null ? '—' : fmtPct(s.actual)}
                  </div>
                  <div className="text-xs text-slate-400">
                    target ≥ {fmtPct(s.target)}
                  </div>
                </div>
                {s.detail && <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{s.detail}</p>}
              </div>
            )
          })}
        </div>

        {/* メトリクスエンドポイント案内 */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-xs dark:border-blue-900/50 dark:bg-blue-950/30">
          <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-blue-900 dark:text-blue-200">
            <BarChart3 size={15} strokeWidth={1.5} aria-hidden />詳細メトリクス (Prometheus)
          </h4>
          <p className="text-blue-800 dark:text-blue-200/80">
            中央エージェントは <code className="rounded bg-blue-100 px-1 dark:bg-blue-900/40">/metrics</code> エンドポイント (デフォルト port 9464) で
            Prometheus 形式のメトリクスを出力します:
          </p>
          <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-blue-900 dark:text-blue-200">
            <li>• <code>edge_commands_total{`{command,result,vendor}`}</code> — コマンド処理数</li>
            <li>• <code>edge_command_duration_seconds</code> — レイテンシ Histogram (p50 / p95 / p99)</li>
            <li>• <code>edge_heartbeat_total{`{result,vendor}`}</code> — 死活回数</li>
            <li>• <code>edge_tenants_assigned</code> — 担当店舗数</li>
            <li>• <code>edge_circuit_breaker_open_total</code> — サーキットブレーカー OPEN 数</li>
          </ul>
          <p className="mt-3 text-blue-800 dark:text-blue-200/80">
            Phase 3 後半で Prometheus + Grafana を Tier 3 サーバに同居させて、p95 latency や error rate を継続グラフ化予定。
          </p>
        </div>

        {/* SLO ターゲット説明 */}
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
          <h4 className="mb-2 text-sm font-semibold text-slate-800 dark:text-slate-100">SLO ターゲット定義</h4>
          <table className="w-full">
            <thead className="text-[10px] uppercase tracking-wider text-slate-500">
              <tr><th className="text-left">指標</th><th className="text-left">目標</th><th className="text-left">エラーバジェット (月間)</th></tr>
            </thead>
            <tbody>
              <tr className="border-t border-slate-100 dark:border-slate-700"><td className="py-1.5">死活監視成功率</td><td>99% (3 ナイン)</td><td>7.2 時間 / 月</td></tr>
              <tr className="border-t border-slate-100 dark:border-slate-700"><td className="py-1.5">コマンド成功率</td><td>99.5%</td><td>3.6 時間 / 月</td></tr>
              <tr className="border-t border-slate-100 dark:border-slate-700"><td className="py-1.5">ノード稼働率</td><td>99.9% (4 ナイン)</td><td>43 分 / 月</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  )
}
