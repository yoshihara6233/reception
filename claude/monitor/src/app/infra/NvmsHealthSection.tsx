/**
 * NVMS 死活サマリ（Phase 1.5 M3・報告型）
 *
 * vendor='nvms' のレコーダが 1 台も無ければ何も描かない（既存構成に変化なし）。
 *
 * クラウドは NVMS 配下のカメラを個別ポーリングしない。NVMS が測った集計と
 * 異常差分を、エッジが 5 分ごとに recorders.health へ書く（/api/edge/nvms-health）。
 * ここで見張るのは 2 つだけ:
 *   - 報告の中身（オフライン台数・容量残）
 *   - **報告の鮮度**（health_at が 15 分止まっていたら、エッジか NVMS の沈黙。
 *     「異常 0 件」と「報告が来ていない」を混同しないための一行を必ず出す）
 */
import { createSupabaseServer } from '@/lib/supabase/server'

interface DownCam { id: number; name: string; folder_path?: string | null }
// errors / restarts_24h は保守自動化・案B（NVMS/docs/DIAGNOSTICS_SPEC.md §1）。
// 未対応ビルドはキーごと送ってこないので、無ければ何も描かない。
interface NvmsErrors {
  count_24h?: number
  warn_24h?: number
  last?: {
    at?: string
    level?: string
    source?: string
    node?: number
    message?: string
  } | null
}
interface NvmsHealth {
  cameras_total?: number
  cameras_online?: number
  cameras_offline?: number
  down?: DownCam[]
  disk_days_left?: number | null
  nodes_total?: number
  nodes_ok?: number
  nvms_version?: string
  errors?: NvmsErrors
  restarts_24h?: number
}
interface Row {
  id: string
  model: string | null
  host: string
  health: NvmsHealth | null
  health_at: string | null
  edge_devices: { name: string; stores: { name: string } | null } | null
}

const STALE_MS = 15 * 60_000

function fmtAgo(iso: string | null, now: number): string {
  if (!iso) return '未受信'
  const sec = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (sec < 90) return `${sec} 秒前`
  if (sec < 5400) return `${Math.round(sec / 60)} 分前`
  return `${Math.round(sec / 3600)} 時間前`
}

export async function NvmsHealthSection() {
  const supa = await createSupabaseServer()
  const { data } = await supa
    .from('recorders')
    .select('id, model, host, health, health_at, edge_devices ( name, stores ( name ) )')
    .eq('vendor', 'nvms')
    .limit(200)

  const rows = (data ?? []) as unknown as Row[]
  if (rows.length === 0) return null

  const now = Date.now()

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-bold text-slate-900">NVMS 死活（報告型）</h2>
        <span className="rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500">
          カメラの個別ポーリングはしません — NVMS の集計を 5 分ごとに受信
        </span>
      </div>

      <div className="space-y-3">
        {rows.map((r) => {
          const h = r.health
          const stale = !r.health_at || now - new Date(r.health_at).getTime() > STALE_MS
          const offline = h?.cameras_offline ?? 0
          const errCount = h?.errors?.count_24h ?? 0
          const storeName = r.edge_devices?.stores?.name ?? r.edge_devices?.name ?? '—'
          const nodes = h?.nodes_total != null ? `${h.nodes_ok ?? '—'} / ${h.nodes_total}` : null
          return (
            <div key={r.id} className="rounded border border-slate-200 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: stale ? '#A3332B' : offline > 0 || errCount > 0 ? '#B5761A' : '#2F7A4F' }}
                />
                <b className="text-slate-900">{r.model || 'NVMS'}</b>
                <span className="text-slate-400">{storeName} ・ {r.host}</span>
                {h?.nvms_version && <span className="font-mono text-[10px] text-slate-400">v{h.nvms_version}</span>}
                <span className={'ml-auto font-mono text-[11px] tabular-nums ' + (stale ? 'font-bold text-red-700' : 'text-slate-500')}>
                  最終報告 {fmtAgo(r.health_at, now)}
                </span>
              </div>

              {stale ? (
                <p className="text-xs text-red-700">
                  報告が止まっています（15 分超）。エッジか NVMS のどちらかが沈黙しています —
                  「異常 0 件」ではありません。
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-700">
                    <span>カメラ <b className="font-mono tabular-nums">{(h?.cameras_total ?? 0).toLocaleString()}</b> 台</span>
                    <span>正常 <b className="font-mono tabular-nums text-emerald-700">{(h?.cameras_online ?? 0).toLocaleString()}</b></span>
                    <span>異常 <b className={'font-mono tabular-nums ' + (offline > 0 ? 'text-amber-700' : '')}>{offline.toLocaleString()}</b></span>
                    {h?.disk_days_left != null && <span>容量残 <b className="font-mono tabular-nums">{Math.floor(h.disk_days_left)}</b> 日</span>}
                    {nodes && <span>ノード <b className="font-mono tabular-nums">{nodes}</b></span>}
                    {h?.errors?.count_24h != null && (
                      <span>エラー 24h <b className={'font-mono tabular-nums ' + (errCount > 0 ? 'text-amber-700' : '')}>{errCount.toLocaleString()}</b> 件</span>
                    )}
                    {(h?.restarts_24h ?? 0) > 0 && (
                      <span>再起動 24h <b className="font-mono tabular-nums text-amber-700">{h!.restarts_24h!.toLocaleString()}</b> 回</span>
                    )}
                  </div>
                  {errCount > 0 && h?.errors?.last?.message && (
                    <p className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-slate-700">
                      <span className="mr-2 font-mono tabular-nums text-slate-400">{fmtAgo(h.errors.last.at ?? null, now)}</span>
                      {h.errors.last.source && <span className="mr-1 text-slate-500">[{h.errors.last.source}{h.errors.last.node != null ? ` node${h.errors.last.node}` : ''}]</span>}
                      {h.errors.last.message.slice(0, 300)}
                    </p>
                  )}
                  {(h?.down?.length ?? 0) > 0 && (
                    <ul className="mt-2 space-y-0.5 text-[11px] text-slate-600">
                      {h!.down!.slice(0, 8).map((c) => (
                        <li key={c.id}>
                          <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-red-600 align-middle" />
                          {c.name}
                          {c.folder_path && <span className="ml-1 text-slate-400">（{c.folder_path}）</span>}
                        </li>
                      ))}
                      {h!.down!.length > 8 && (
                        <li className="text-slate-400">ほか {h!.down!.length - 8} 台（NVMS 側で確認してください）</li>
                      )}
                    </ul>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
