/**
 * Right-side detail panel: store info, edge agent telemetry, recorder spec,
 * camera list. Server component — single fetch per page render.
 */
import { Video } from 'lucide-react'
import { createSupabaseServer } from '@/lib/supabase/server'
import { deriveEdgeStatus, type DerivedEdgeStatus } from '@/lib/edge-status'

// 鮮度OK の動作モード表示（status 文字列ベース）。中断/停止/未設置は派生結果で上書き。
const MODE_LABEL: Record<string, { label: string; cls: string }> = {
  online:  { label: '● オンライン', cls: 'bg-emerald-100 text-emerald-700' },
  idle:    { label: '● 待機',       cls: 'bg-emerald-100 text-emerald-700' },
  grid:    { label: '● 監視中',     cls: 'bg-blue-100 text-blue-700' },
  live:    { label: '● ライブ中',   cls: 'bg-violet-100 text-violet-700' },
  vod:     { label: '● 再生中',     cls: 'bg-orange-100 text-orange-700' },
  bcp:     { label: '● BCP撮影中',  cls: 'bg-amber-100 text-amber-700' },
  error:   { label: '● エラー',     cls: 'bg-red-100 text-red-700' },
  offline: { label: '● オフライン', cls: 'bg-slate-200 text-slate-600' },
}
const MODE_FALLBACK = { label: '● 不明', cls: 'bg-slate-200 text-slate-600' }

/**
 * TC3: 監視プレーン状態 → バッジ表示。中断/停止/未設置は last_seen 鮮度で派生した
 * plane を優先し、固着した status 文字列（grid 等）に化けさせない。
 */
function statusBadge(d: DerivedEdgeStatus): { label: string; cls: string } {
  switch (d.plane) {
    case 'interrupted':  return { label: '● 監視中断', cls: 'bg-red-100 text-red-700' }
    case 'stopped':      return { label: '● 監視停止', cls: 'bg-slate-200 text-slate-600' }
    case 'unconfigured': return { label: '● 未設置',   cls: 'bg-slate-200 text-slate-600' }
    default:             return MODE_LABEL[d.mode ?? 'idle'] ?? MODE_FALLBACK
  }
}

export async function StoreDetail({ storeId }: { storeId: string }) {
  const supa = await createSupabaseServer()
  const { data: store } = await supa
    .from('stores')
    .select(`
      id, name, address, area_code,
      edge_devices ( id, name, agent_version, status, last_seen_at,
        recorders ( id, vendor, model, host,
          recorder_cameras ( id, channel, name, enabled )
        )
      )
    `)
    .eq('id', storeId)
    .single()

  if (!store) {
    return <div className="p-4 text-xs text-slate-500">店舗が見つかりません</div>
  }

  const s    = store as never as {
    name: string; address: string | null; area_code: string | null;
    edge_devices: {
      id: string; name: string; agent_version: string | null; status: string; last_seen_at: string | null;
      recorders: {
        vendor: string; model: string | null; host: string;
        recorder_cameras: { id: string; channel: number; name: string; enabled: boolean }[]
      }[]
    }[]
  }
  const edge = s.edge_devices?.[0]
  const rec  = edge?.recorders?.[0]
  const cams = rec?.recorder_cameras ?? []
  // TC3: last_seen 鮮度を真実源に監視プレーン状態を派生（status 文字列の固着を補正）。
  const derived    = deriveEdgeStatus(edge?.status, edge?.last_seen_at)
  const statusInfo = statusBadge(derived)

  return (
    <aside className="flex-1 min-h-0 overflow-y-auto border-l border-slate-200 bg-white text-xs">
      <Section title="店舗情報">
        <Kv label="店舗名" value={s.name} />
        <Kv label="店舗 ID" value={storeId.slice(0, 8)} />
        <Kv label="住所" value={s.address ?? '—'} />
        <Kv label="エリア" value={s.area_code ?? '—'} />
        <Kv label="状態">
          <span className={`inline-block rounded-full px-2 py-px text-[11px] font-semibold ${statusInfo.cls}`}>
            {statusInfo.label}
          </span>
          {/* TC3: 監視/録画区別 — 監視が止まっても録画は NVR 本体で継続する旨を明示。 */}
          {derived.recordingContinues && (
            <p className="mt-1 flex items-center gap-1 text-[10px] leading-tight text-slate-500">
              <Video size={11} strokeWidth={1.5} aria-hidden />録画はレコーダ本体で継続中（監視プレーンのみ中断）
            </p>
          )}
        </Kv>
        <Kv
          label="最終接続"
          value={edge?.last_seen_at ? new Date(edge.last_seen_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '—'}
        />
      </Section>

      {edge && (
        <Section title="エッジサーバ">
          <Kv label="名前" value={edge.name} />
          <Kv label="バージョン" value={edge.agent_version ?? '—'} />
          <Kv label="モード" value={edge.status} />
        </Section>
      )}

      {rec && (
        <Section title="レコーダ">
          <Kv label="ベンダ" value={rec.vendor} />
          <Kv label="機種"   value={rec.model ?? '—'} />
          <Kv label="IP"     value={rec.host} />
        </Section>
      )}

      <Section title={`カメラ一覧 (${cams.length})`}>
        {cams.map((c) => (
          <div key={c.id} className="flex justify-between border-b border-slate-100 py-1 last:border-b-0">
            <span>ch{String(c.channel).padStart(2, '0')} {c.name}</span>
            <span className={c.enabled ? 'text-emerald-600' : 'text-slate-400'}>
              {c.enabled ? '● 有効' : '● 無効'}
            </span>
          </div>
        ))}
      </Section>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-200 p-3.5">
      <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">{title}</h4>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Kv({ label, value, children }: { label: string; value?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-x-2 gap-y-1">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-900">{children ?? value}</dd>
    </div>
  )
}
