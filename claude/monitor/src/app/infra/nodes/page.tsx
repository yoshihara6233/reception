/**
 * F49.G: /infra/nodes — 中央エージェントノード状況
 *
 * Tier 3 集約モードで稼働中の central_nodes を一覧表示。
 * - 各ノードのステータス (active / draining / down)
 * - 担当店舗数 / capacity
 * - リース有効期限 (健全性指標)
 * - 最終ハートビート
 *
 * Phase 2 では HA ノードペアの可視化と「片系落とした時」の挙動確認用。
 * Phase 3 で metrics (CPU / RAM / 帯域) を追加予定。
 */
import { createSupabaseServer } from '@/lib/supabase/server'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'

interface CentralNodeRow {
  id:                string
  hostname:          string
  region:            string | null
  capacity_stores:   number
  status:            'active' | 'draining' | 'down'
  lease_held_until:  string | null
  last_heartbeat:    string | null
  metadata:          Record<string, unknown> | null
  created_at:        string
}

interface StoreCountRow {
  central_node_id:  string
  count:            number
}

const STATUS_STYLE = {
  active:   { label: '稼働中',   style: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300', emoji: '🟢' },
  draining: { label: '排出中',   style: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',     emoji: '🟡' },
  down:     { label: 'ダウン',   style: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',                 emoji: '🔴' },
} as const

function fmtTimeAgo(iso: string | null): string {
  if (!iso) return '—'
  const elapsed = Math.max(0, Date.now() - new Date(iso).getTime())
  const sec = Math.floor(elapsed / 1000)
  if (sec < 60)      return `${sec}秒前`
  if (sec < 3600)    return `${Math.floor(sec / 60)}分前`
  if (sec < 86400)   return `${Math.floor(sec / 3600)}時間前`
  return `${Math.floor(sec / 86400)}日前`
}

function fmtLeaseStatus(leaseIso: string | null): { label: string; valid: boolean } {
  if (!leaseIso) return { label: '未取得', valid: false }
  const remainingMs = new Date(leaseIso).getTime() - Date.now()
  if (remainingMs <= 0) return { label: '失効', valid: false }
  const remainingSec = Math.floor(remainingMs / 1000)
  if (remainingSec < 60)   return { label: `あと ${remainingSec}秒`, valid: true }
  if (remainingSec < 3600) return { label: `あと ${Math.floor(remainingSec / 60)}分`, valid: true }
  return { label: `あと ${Math.floor(remainingSec / 3600)}時間`, valid: true }
}

export default async function InfraNodesPage() {
  const supa = await createSupabaseServer()

  // 中央ノード一覧
  let nodes: CentralNodeRow[] = []
  try {
    const { data } = await supa
      .from('central_nodes')
      .select('*')
      .order('hostname')
    nodes = ((data ?? []) as unknown as CentralNodeRow[])
  } catch {
    /* テーブル未存在: 空配列 */
  }

  // ノード別の担当店舗数を集計
  // (count() の group by は Supabase JS SDK では rpc 経由か手動集計)
  const storeCountMap = new Map<string, number>()
  if (nodes.length > 0) {
    try {
      const { data: storesData } = await supa
        .from('stores')
        .select('central_node_id')
        .in('central_node_id', nodes.map((n) => n.id))
      for (const row of ((storesData ?? []) as Array<{ central_node_id: string }>)) {
        storeCountMap.set(row.central_node_id, (storeCountMap.get(row.central_node_id) ?? 0) + 1)
      }
    } catch { /* ignore */ }
  }

  const totalAssigned = [...storeCountMap.values()].reduce((s, n) => s + n, 0)
  const totalCapacity = nodes.reduce((s, n) => s + n.capacity_stores, 0)
  const activeCount = nodes.filter((n) => n.status === 'active').length
  const failureCount = nodes.filter((n) => {
    const ls = fmtLeaseStatus(n.lease_held_until)
    return n.status === 'down' || (!ls.valid && n.status === 'active')
  }).length

  return (
    <AdminShell pathname="/infra/nodes" section="infra">
      <PageHeader
        title="中央エージェント ノード"
        crumb={[
          { href: '/infra',       label: 'インフラ' },
          { href: '/infra/nodes', label: 'ノード状況' },
        ]}
      />

      <div className="px-5 py-4 space-y-4">
        {/* サマリ統計 */}
        <div className="grid grid-cols-4 gap-4">
          <SummaryCard label="ノード数" value={nodes.length} sub="登録済" />
          <SummaryCard label="稼働中" value={activeCount} sub={`/ ${nodes.length}`} highlight={failureCount > 0 ? 'warn' : 'ok'} />
          <SummaryCard label="担当中" value={totalAssigned} sub={`/ ${totalCapacity} 容量`} />
          <SummaryCard label="失効/障害" value={failureCount} sub={failureCount > 0 ? '要確認' : 'なし'} highlight={failureCount > 0 ? 'fail' : 'ok'} />
        </div>

        {/* ノード一覧 */}
        {nodes.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
            まだ中央エージェントノードが登録されていません。<br />
            <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs dark:bg-slate-900">CENTRAL_NODE_ID</code> 環境変数を設定した edge-agent を起動すると自動登録されます。
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 text-left">ホスト名</th>
                  <th className="px-3 py-2 text-left">リージョン</th>
                  <th className="px-3 py-2 text-left">状態</th>
                  <th className="px-3 py-2 text-right">担当 / 容量</th>
                  <th className="px-3 py-2 text-left">リース</th>
                  <th className="px-3 py-2 text-left">最終 HB</th>
                  <th className="px-3 py-2 text-left">登録日</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => {
                  const sty = STATUS_STYLE[n.status]
                  const lease = fmtLeaseStatus(n.lease_held_until)
                  const assigned = storeCountMap.get(n.id) ?? 0
                  const pct = n.capacity_stores > 0 ? Math.round((assigned / n.capacity_stores) * 100) : 0
                  return (
                    <tr key={n.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="px-3 py-2">
                        <div className="font-mono font-semibold text-slate-800 dark:text-slate-100">{n.hostname}</div>
                        <div className="text-[10px] text-slate-400">{n.id.slice(0, 8)}…</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-500">{n.region ?? '—'}</td>
                      <td className="px-3 py-2">
                        <span className={'rounded px-2 py-0.5 text-[11px] font-semibold ' + sty.style}>
                          {sty.emoji} {sty.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="font-mono tabular-nums text-slate-800 dark:text-slate-100">
                          {assigned.toLocaleString()} / {n.capacity_stores.toLocaleString()}
                        </div>
                        <div className="mt-1 h-1.5 w-24 ml-auto overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                          <div
                            className={'h-full ' + (pct > 90 ? 'bg-red-500' : pct > 70 ? 'bg-yellow-500' : 'bg-emerald-500')}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={lease.valid ? 'text-slate-700 dark:text-slate-200' : 'text-red-600 dark:text-red-400'}>
                          {lease.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{fmtTimeAgo(n.last_heartbeat)}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                        {new Date(n.created_at).toISOString().slice(0, 10)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* 説明 */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200">
          <strong>中央集約モード</strong>では、複数の中央エージェントノードが Active-Active 構成で全店舗を分担します。
          ノードがダウン (status=down or リース失効) すると、他ノードが自動的に担当店舗を引き継ぎます。
        </div>
      </div>
    </AdminShell>
  )
}

function SummaryCard({
  label, value, sub, highlight,
}: {
  label: string; value: number | string; sub?: string
  highlight?: 'ok' | 'warn' | 'fail'
}) {
  const valueColor =
    highlight === 'fail' ? 'text-red-600 dark:text-red-400' :
    highlight === 'warn' ? 'text-yellow-600 dark:text-yellow-400' :
    'text-slate-900 dark:text-slate-100'
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${valueColor}`}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>}
    </div>
  )
}
