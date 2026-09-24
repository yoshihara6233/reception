'use client'

import { useState } from 'react'

export interface FleetRow {
  edgeId: string; store: string; name: string
  status: string; seenStale: boolean; lastSeenAt: string | null
  camerasTotal: number; camerasOffline: number
  nodesOk: number | null; nodesTotal: number | null
  errors24h: number; healthStale: boolean; diskDaysLeft: number | null
  running: string | null; desiredVer: string | null; verPending: boolean
  cfgState: 'none' | 'pending' | 'applied'
  licenseOrg: string | null; licenseExpires: string | null; licenseExpired: boolean
  attention: boolean
}

function ago(iso: string | null): string {
  if (!iso) return '未受信'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 90) return `${s} 秒前`
  if (s < 5400) return `${Math.round(s / 60)} 分前`
  return `${Math.round(s / 3600)} 時間前`
}

export function FleetClient({ rows }: { rows: FleetRow[] }) {
  const [attentionOnly, setAttentionOnly] = useState(false)
  const attentionCount = rows.filter((r) => r.attention).length
  const camerasTotal = rows.reduce((n, r) => n + r.camerasTotal, 0)
  const camerasOffline = rows.reduce((n, r) => n + r.camerasOffline, 0)
  const errorsTotal = rows.reduce((n, r) => n + (r.healthStale ? 0 : r.errors24h), 0)
  const shown = attentionOnly ? rows.filter((r) => r.attention) : rows

  return (
    <div className="space-y-5">
      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile lab="監視拠点" big={rows.length} sub="nvms アップリンク" />
        <Tile lab="要対応" big={attentionCount} sub="沈黙・エラー・未反映・版/期限" warn={attentionCount > 0} />
        <Tile lab="カメラ" big={camerasTotal} sub={`オフライン ${camerasOffline}`} warn={camerasOffline > 0} />
        <Tile lab="エラー 24h" big={errorsTotal} sub="全拠点合計（報告新鮮ぶん）" warn={errorsTotal > 0} />
      </div>

      <section className="rounded-lg border border-slate-200 bg-white text-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-3">
          <h2 className="font-bold text-slate-900">拠点一覧</h2>
          <span className="text-[11px] text-slate-400">要対応を上に表示</span>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />
            要対応のみ
          </label>
        </div>
        {shown.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-slate-400">
            {rows.length === 0 ? 'nvms アップリンクの拠点がまだありません。' : '要対応の拠点はありません。'}
          </p>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">拠点 / エッジ</th>
                <th className="px-3 py-2 text-left">稼働</th>
                <th className="px-3 py-2 text-left">カメラ / ノード</th>
                <th className="px-3 py-2 text-left">エラー24h</th>
                <th className="px-3 py-2 text-left">設定</th>
                <th className="px-3 py-2 text-left">版</th>
                <th className="px-3 py-2 text-left">ライセンス</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.edgeId} className={'border-t border-slate-100 align-top ' + (r.attention ? 'bg-amber-50/40' : '')}>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.seenStale ? '#A3332B' : r.attention ? '#B5761A' : '#2F7A4F' }} />
                      <a href={`/admin/edges/${r.edgeId}`} className="font-medium text-blue-600 hover:underline">{r.store}</a>
                    </div>
                    <div className="ml-3.5 text-slate-400">{r.name}</div>
                  </td>
                  <td className={'px-3 py-2.5 ' + (r.seenStale ? 'text-red-700 font-semibold' : 'text-slate-600')}>
                    {r.seenStale ? '沈黙' : r.status}<div className="text-[10px] font-normal text-slate-400">{ago(r.lastSeenAt)}</div>
                  </td>
                  <td className="px-3 py-2.5 font-mono tabular-nums text-slate-700">
                    {r.healthStale ? <span className="text-slate-400">報告待ち</span> : (
                      <>
                        {(r.camerasTotal - r.camerasOffline).toLocaleString()}/{r.camerasTotal.toLocaleString()}
                        {r.camerasOffline > 0 && <span className="text-amber-700"> ⚠{r.camerasOffline}</span>}
                        {r.nodesTotal != null && <div className="text-[10px] text-slate-500">ノード {r.nodesOk ?? '—'}/{r.nodesTotal}</div>}
                      </>
                    )}
                  </td>
                  <td className={'px-3 py-2.5 font-mono tabular-nums ' + (!r.healthStale && r.errors24h > 0 ? 'text-amber-700 font-bold' : 'text-slate-500')}>
                    {r.healthStale ? '—' : r.errors24h}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.cfgState === 'none' ? <span className="text-slate-400">未設定</span>
                      : r.cfgState === 'applied' ? <span className="text-emerald-700">反映済み</span>
                      : <span className="text-amber-700 font-semibold">反映待ち</span>}
                  </td>
                  <td className="px-3 py-2.5 font-mono">
                    {r.running ?? '—'}
                    {r.verPending && <div className="text-[10px] font-sans text-amber-700">→ {r.desiredVer}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    {!r.licenseOrg && !r.licenseExpires ? <span className="text-slate-400">—</span> : (
                      <span className={r.licenseExpired ? 'text-red-700 font-semibold' : 'text-slate-600'}>
                        {r.licenseExpires ?? '無期限'}{r.licenseExpired && '（期限切れ）'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {r.attention && <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">要対応</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </section>
      <p className="text-[11px] text-slate-400">
        要対応＝沈黙（15分報告なし）／カメラオフライン／エラー24h &gt;0／設定 反映待ち／版 不一致／ライセンス期限切れ のいずれか。
        「報告待ち」は死活報告（5分毎）が15分以上途絶＝エッジか G・VMS の沈黙で、「異常0」ではありません。
      </p>
    </div>
  )
}

function Tile({ lab, big, sub, warn }: { lab: string; big: number; sub: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-[11px] uppercase tracking-wider text-slate-400">{lab}</div>
      <div className={'mt-1 font-mono text-2xl tabular-nums ' + (warn ? 'text-amber-700' : 'text-slate-900')}>{big.toLocaleString()}</div>
      <div className="mt-0.5 text-[11px] text-slate-400">{sub}</div>
    </div>
  )
}
