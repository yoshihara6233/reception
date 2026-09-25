'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Settings, Search, Plug, X } from 'lucide-react'
import { edgePkg } from '@/lib/admin/nvmsd-releases'

interface Camera {
  id?: string                 // undefined until saved
  channel: number
  name: string
  grid_pos: number
  enabled: boolean
  frigate_camera: string | null
  hls_url: string | null      // go2rtc stream URL 上書き
  live_rtsp: string | null    // go2rtc 自動登録 RTSP ソース
  folder_path?: string | null // NVMS フォルダ（同期で上書きされる・表示のみ）
  _new?: boolean              // local-only marker
  _del?: boolean
  _dirty?: boolean
}
interface Recorder {
  id: string
  vendor: 'ipro' | 'frigate' | 'onvif-generic' | 'i-pro-nvr' | 'nvms'
  model: string | null
  host: string
  rtsp_port: number
  onvif_port: number | null
  username: string
  notes: string | null
  live_host: string | null
  vod_host: string | null
  vod_username: string | null
  vod_channel: number | null
  vod_has_password: boolean
  has_password: boolean       // 値は返さない。設定済みか否かのみ
  // Phase 2b（nvms のみ）: BCP 収集方式と対象フォルダ
  bcp_capture_mode: 'grid' | 'per_camera' | null
  bcp_folder_paths: string[] | null
  // A1 設定遠隔投入（nvms のみ）
  desired_config: Record<string, unknown> | null
  config_version: number
  config_rejected: { key: string; reason: string }[]
  recorder_cameras: Camera[]
}
interface EdgePayload {
  id: string; name: string; status: string; agent_version: string | null; last_seen_at: string | null;
  store_id: string
  go2rtc_host: string | null
  nvr_clock_offset_sec: number | null
  nvr_clock_checked_at: string | null
  cloudflared_version: string | null
  desired_agent_version: string | null
  desired_cloudflared_version: string | null
  ota_status: string | null
  ota_updated_at: string | null
  ota_last_error: string | null
  // nvmsd OTA（NVMS/docs/OTA_SPEC.md）: 更新許可時間帯（JST）と即時フラグ
  update_window_start: string | null
  update_window_end: string | null
  update_force: boolean
  ota_mode: 'onsite' | 'auto'
  pkg_format: string | null
  pkg_arch: string | null
  applied_config_version: number | null
  // 版と使える機能の名乗り・遠隔視聴の状況（GVMS_CLOUD_SPEC §2・§5.5）
  spec_version: number | null
  capabilities: string[] | null
  video_sessions_now: number | null
  video_kbps: number | null
  stores: { name: string; area_code: string | null }
  recorders: Recorder[]
}
// 診断バンドル（保守自動化①・案A・NVMS/docs/DIAGNOSTICS_SPEC.md §2）
interface DiagBundle {
  request_id: string
  status: 'pending' | 'completed' | 'failed'
  bytes: number | null
  error: string | null
  created_at: string
  uploaded_at: string | null
}

export function EdgeDetail({ edge, bundles = [] }: { edge: EdgePayload; bundles?: DiagBundle[] }) {
  const router = useRouter()
  const [go2rtcHost, setGo2rtcHost] = useState(edge.go2rtc_host ?? '')
  const [hostBusy, setHostBusy]     = useState(false)
  const [hostMsg, setHostMsg]       = useState<string | null>(null)
  const hostDirty = go2rtcHost !== (edge.go2rtc_host ?? '')

  async function deleteEdge() {
    if (!confirm(`エッジ "${edge.name}" を削除しますか？\n関連レコーダ・カメラ・セッションも削除されます。`)) return
    const res = await fetch(`/api/admin/edges/${edge.id}`, { method: 'DELETE' })
    if (res.ok) router.push('/admin/edges')
    else alert(`削除失敗: ${res.status}`)
  }

  async function saveGo2rtcHost() {
    setHostBusy(true); setHostMsg(null)
    const res = await fetch(`/api/admin/edges/${edge.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ go2rtc_host: go2rtcHost }),
    })
    setHostBusy(false)
    if (!res.ok) { const j = await res.json().catch(() => ({})); setHostMsg(j.error ?? `保存失敗: ${res.status}`); return }
    setHostMsg('保存しました'); router.refresh()
  }

  return (
    <div className="space-y-5">
      {/* Edge summary */}
      <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold text-slate-900">エッジサーバ情報</h2>
          <button onClick={deleteEdge} className="inline-flex items-center gap-1 rounded border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50">
            <Trash2 size={14} strokeWidth={1.5} aria-hidden /> 削除
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
          <Row k="店舗"        v={`${edge.stores.area_code ? `[${edge.stores.area_code}] ` : ''}${edge.stores.name}`} />
          <Row k="状態"        v={edge.status} />
          <Row k="バージョン"  v={edge.agent_version ?? '—'} />
          {edge.agent_version?.startsWith('nvmsd/') && (
            <>
              <Row k="使える機能" v={
                edge.capabilities
                  ? <span className="font-ge-mono">{`v${edge.spec_version ?? '?'} · ${edge.capabilities.join(', ') || '—'}`}</span>
                  : <span className="text-slate-500">名乗り無し（0.1.67 以前の既定）</span>
              } />
              <Row k="遠隔視聴" v={
                <span className="font-ge-mono tabular-nums">
                  {`${(edge.video_sessions_now ?? 0).toLocaleString('ja-JP')} 本 · ${(edge.video_kbps ?? 0).toLocaleString('ja-JP')} kbps`}
                </span>
              } />
            </>
          )}
          <Row k="最終接続"    v={edge.last_seen_at ? new Date(edge.last_seen_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '—'} />
          {/* NVR 時計ズレ（エッジ実測・30分毎）。±10 秒超は証跡の時刻精度に影響するため警告色。 */}
          <Row k="NVR 時刻差" v={
            edge.nvr_clock_offset_sec == null ? '—' : (
              <span className={Math.abs(edge.nvr_clock_offset_sec) >= 10 ? 'font-semibold text-amber-700' : undefined}>
                {edge.nvr_clock_offset_sec > 0 ? '+' : ''}{edge.nvr_clock_offset_sec} 秒
                {edge.nvr_clock_checked_at && (
                  <span className="ml-1 font-normal text-slate-400">
                    （{new Date(edge.nvr_clock_checked_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })} 実測）
                  </span>
                )}
              </span>
            )
          } />
        </dl>

        {/* go2rtc 公開オリジン（高画質ライブ・従来はSQL直編集） */}
        <div className="mt-4 border-t border-slate-100 pt-3">
          <Field label="go2rtc 公開オリジン (Cloudflare Tunnel)">
            <div className="flex items-center gap-2">
              <input
                value={go2rtcHost}
                onChange={(e) => setGo2rtcHost(e.target.value)}
                className="w-full max-w-md rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                placeholder="https://go2rtc-poc.genesis-edge.com"
              />
              <button
                onClick={saveGo2rtcHost}
                disabled={hostBusy || !hostDirty}
                className="shrink-0 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                {hostBusy ? '保存中…' : '保存'}
              </button>
              {hostMsg && <span className="shrink-0 text-xs text-emerald-700">{hostMsg}</span>}
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              配下の ONVIFカメラ直 が高画質ライブで継承（カメラ個別の「HLS URL」で上書き可）。
            </p>
          </Field>
        </div>
      </section>

      {/* 自律OTA: nvmsd 内蔵アップリンクは配布物も更新経路も別物（agent-update
          ポーリング＋G・VMS 署名検証）なので専用パネルに分ける。 */}
      {edge.agent_version?.startsWith('nvmsd/')
        ? <NvmsdOtaPanel edge={edge} />
        : <OtaPanel edge={edge} />}

      {/* 診断バンドル（案A）— nvmsd アップリンクのみ */}
      {edge.agent_version?.startsWith('nvmsd/') && (
        <DiagnosticsPanel edgeId={edge.id} bundles={bundles} />
      )}

      {/* 設定の遠隔投入（A1）— nvmsd アップリンクのみ・nvms レコーダが対象 */}
      {edge.agent_version?.startsWith('nvmsd/') && (() => {
        const rec = edge.recorders.find((r) => r.vendor === 'nvms')
        return rec ? <ConfigPushPanel recorder={rec} appliedVersion={edge.applied_config_version} /> : null
      })()}

      {/* Recorders */}
      <RecorderList edgeId={edge.id} recorders={edge.recorders} />
    </div>
  )
}

const OTA_STATUS_META: Record<string, { label: string; cls: string }> = {
  idle:           { label: '待機', cls: 'bg-slate-100 text-slate-600' },
  updating:       { label: '更新中', cls: 'bg-amber-100 text-amber-700' },
  pending_verify: { label: '検証中', cls: 'bg-amber-100 text-amber-700' },
  healthy:        { label: '正常', cls: 'bg-emerald-100 text-emerald-700' },
  rolled_back:    { label: 'ロールバック', cls: 'bg-red-100 text-red-700' },
}

/** 自律OTA パネル: 現行/目標版の表示・desired 設定/解除・全店舗へ promote。 */
function OtaPanel({ edge }: { edge: EdgePayload }) {
  const router = useRouter()
  const [agent, setAgent] = useState(edge.desired_agent_version ?? '')
  const [cfd, setCfd]     = useState(edge.desired_cloudflared_version ?? '')
  const [busy, setBusy]   = useState(false)
  const [msg, setMsg]     = useState<string | null>(null)
  const dirty = agent !== (edge.desired_agent_version ?? '') || cfd !== (edge.desired_cloudflared_version ?? '')
  const meta = OTA_STATUS_META[edge.ota_status ?? 'idle'] ?? OTA_STATUS_META.idle

  async function saveDesired() {
    setBusy(true); setMsg(null)
    // 貼り付け時の前後空白を除去（末尾スペースで OTA が invalid reference になる事故防止）。
    const agentTrimmed = agent.trim(); const cfdTrimmed = cfd.trim()
    if (agentTrimmed !== agent) setAgent(agentTrimmed)
    if (cfdTrimmed !== cfd) setCfd(cfdTrimmed)
    const res = await fetch(`/api/admin/edges/${edge.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desired_agent_version: agentTrimmed, desired_cloudflared_version: cfdTrimmed }),
    })
    setBusy(false)
    if (!res.ok) { const j = await res.json().catch(() => ({})); setMsg(j.error ?? `保存失敗: ${res.status}`); return }
    setMsg('目標版を設定しました（次回 pull で適用）'); router.refresh()
  }

  async function clearDesired() {
    setAgent(''); setCfd('')
    setBusy(true); setMsg(null)
    const res = await fetch(`/api/admin/edges/${edge.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desired_agent_version: '', desired_cloudflared_version: '' }),
    })
    setBusy(false)
    if (!res.ok) { const j = await res.json().catch(() => ({})); setMsg(j.error ?? `解除失敗: ${res.status}`); return }
    setMsg('目標版を解除しました'); router.refresh()
  }

  async function promoteAll() {
    const v = edge.agent_version
    if (!v) return
    if (edge.ota_status !== 'healthy') { setMsg('healthy な端末からのみ全台 promote できます'); return }
    if (!confirm(`現行版 ${v} を全店舗のエッジへ展開します。\nこのカナリアで healthy を確認済みですか？`)) return
    setBusy(true); setMsg(null)
    const res = await fetch('/api/admin/edges/ota/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'agent', version: v }),
    })
    setBusy(false)
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setMsg(j.error ?? `promote 失敗: ${res.status}`); return }
    setMsg(`全店舗へ promote しました（${j.updated ?? 0} 台に ${v} を設定）`); router.refresh()
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold text-slate-900">自律OTA</h2>
        <span className={'rounded px-2 py-0.5 text-[11px] font-semibold ' + meta.cls}>{meta.label}</span>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs md:grid-cols-3">
        <Row k="現行 agent"   v={<span className="font-mono">{edge.agent_version ?? '—'}</span>} />
        <Row k="現行 cloudflared" v={<span className="font-mono">{edge.cloudflared_version ?? '—'}</span>} />
        <Row k="最終OTA"      v={edge.ota_updated_at ? new Date(edge.ota_updated_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }) : '—'} />
      </dl>
      {edge.ota_last_error && (
        <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
          直近の失敗: {edge.ota_last_error}
        </p>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 md:grid-cols-2">
        <Field label="目標 agent 版 (git short sha・空=指示なし)">
          <input value={agent} onChange={(e) => setAgent(e.target.value)}
                 className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                 placeholder="例: a1b2c3d" />
        </Field>
        <Field label="目標 cloudflared 版 (空=指示なし)">
          <input value={cfd} onChange={(e) => setCfd(e.target.value)}
                 className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                 placeholder="例: 2026.6.1" />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {msg && <span className="mr-auto text-xs text-emerald-700">{msg}</span>}
        <button onClick={promoteAll} disabled={busy || edge.ota_status !== 'healthy'}
                title={edge.ota_status === 'healthy' ? '' : 'healthy な端末からのみ可'}
                className="rounded border border-slate-300 bg-white px-3 py-1 text-xs disabled:opacity-50">
          現行版を全店舗へ promote
        </button>
        <button onClick={clearDesired} disabled={busy}
                className="rounded border border-slate-300 bg-white px-3 py-1 text-xs disabled:opacity-50">
          目標版を解除
        </button>
        <button onClick={saveDesired} disabled={busy || !dirty}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
          {busy ? '保存中…' : '目標版を設定'}
        </button>
      </div>
      <p className="mt-2 text-[10px] text-slate-400">
        per-device＝カナリア。1台で <b>正常</b> を確認してから「全店舗へ promote」で段階展開します。
        エッジは <code>/api/edge/bootstrap</code> を約5分間隔で pull し、目標版に追従して自己更新・健全性検証・自動ロールバックします。
      </p>
    </section>
  )
}

/**
 * nvmsd OTA パネル（NVMS/docs/OTA_SPEC.md §3・§6）。
 *
 * エッジ箱の OtaPanel と別物: 目標版は自由入力でなくリリース台帳から選ぶ
 * （登録の無い版を配って agent-update が黙る事故を防ぐ）。時間帯（JST・
 * 既定 02:00-05:00）はサーバ側判定なので、ここは値の置き場だけ。
 * 「今すぐ更新」は時間帯を無視する 1 回きりのフラグ（目標到達で自動解除）。
 */
function NvmsdOtaPanel({ edge }: { edge: EdgePayload }) {
  const router = useRouter()
  const running = (edge.agent_version ?? '').replace(/^nvmsd\//, '')
  const [releases, setReleases] = useState<{ version: string; pkg_format: string; pkg_arch: string; created_at: string }[] | null>(null)
  const pkg = edgePkg(edge)
  const [desired, setDesired] = useState(edge.desired_agent_version ?? '')
  const [winStart, setWinStart] = useState(edge.update_window_start?.slice(0, 5) ?? '')
  const [winEnd, setWinEnd] = useState(edge.update_window_end?.slice(0, 5) ?? '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const dirty =
    desired !== (edge.desired_agent_version ?? '') ||
    winStart !== (edge.update_window_start?.slice(0, 5) ?? '') ||
    winEnd !== (edge.update_window_end?.slice(0, 5) ?? '')

  useEffect(() => {
    fetch('/api/admin/nvmsd-releases')
      .then((r) => (r.ok ? r.json() : { releases: [] }))
      .then((j) => setReleases(j.releases ?? []))
      .catch(() => setReleases([]))
  }, [])

  const pending = !!edge.desired_agent_version && running !== edge.desired_agent_version
  const isAuto = edge.ota_mode === 'auto'

  // 「戻す」配備は不可（OTA_SPEC 付録A・2026-09-18 取り下げ）: 拠点側の検証が
  // 古い版を拒む。版文字列は順序比較できないので、台帳の登録日時で
  // 「選ぼうとしている版が稼働版より古い可能性」を検知して警告する
  // （稼働版が台帳に無い初期は判定不能＝警告なし。静的な注意書きが下にある）。
  // 台帳は (版・形式・arch) の行。目標版の選択肢は版で重複を除き、この拠点の形式の配布物が
  // あるかを別に判定する（無い版を目標にすると拠点は 204 で何も届かない）。
  const versions = [...new Map((releases ?? []).map((r) => [r.version, r])).values()]
  const hasPkg = (v: string) => !!releases?.some((r) => r.version === v && r.pkg_format === pkg.format && r.pkg_arch === pkg.arch)
  const selectedMissing = !!desired && releases !== null && releases.some((r) => r.version === desired) && !hasPkg(desired)
  const runningRel = releases?.find((r) => r.version === running)
  const selectedRel = releases?.find((r) => r.version === desired)
  const downgradeLikely = !!runningRel && !!selectedRel && desired !== running &&
    new Date(selectedRel.created_at).getTime() < new Date(runningRel.created_at).getTime()

  async function put(body: Record<string, unknown>, okMsg: string) {
    setBusy(true); setMsg(null)
    const res = await fetch(`/api/admin/edges/${edge.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setBusy(false)
    if (!res.ok) { const j = await res.json().catch(() => ({})); setMsg(j.error ?? `保存失敗: ${res.status}`); return }
    setMsg(okMsg); router.refresh()
  }

  function save() {
    void put(
      { desired_agent_version: desired, update_window_start: winStart, update_window_end: winEnd },
      desired ? '目標版を設定しました（時間帯内の次回ポーリングで適用）' : '目標版を解除しました',
    )
  }

  function forceNow() {
    if (!edge.desired_agent_version) return
    if (!confirm(`時間帯を無視して今すぐ ${edge.desired_agent_version} へ更新させますか？\n（検証拠点向け。適用確認後にフラグは自動で降ります）`)) return
    void put({ update_force: true }, '即時更新フラグを立てました（次回ポーリング＝最長10分以内に適用開始）')
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold text-slate-900">自動バージョンアップ（nvmsd）</h2>
        <span className={'rounded px-2 py-0.5 text-[11px] font-semibold ' + (
          !edge.desired_agent_version ? 'bg-slate-100 text-slate-600'
            : pending ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
          {!edge.desired_agent_version ? '指示なし' : pending ? '更新待ち' : '目標版で稼働中'}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
        <Row k="稼働版" v={<span className="font-mono">{running || '—'}</span>} />
        <Row k="目標版" v={<span className="font-mono">{edge.desired_agent_version ?? '—'}</span>} />
        <Row k="形式" v={
          <span className="font-mono">
            {pkg.format} / {pkg.arch}
            {!edge.pkg_format && <span className="ml-1 font-sans text-[10px] text-slate-400">（名乗りなし＝既定）</span>}
          </span>
        } />
      </dl>

      {/* 配信モード（OTA_SPEC 付録A・2026-09-18）: 更新で録画が約5秒欠けるため、
          複数台の拠点は現地更新（欠損なし）、1台の拠点は自動、と切り分ける。既定は現地。 */}
      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="mb-1 text-xs font-medium text-slate-600">配信モード</div>
        <div className="flex flex-wrap gap-2">
          {([
            ['onsite', '現地更新（既定）', 'クラウドから配信しない。画面から現地で更新（録画欠損なし）。複数台の拠点向け。'],
            ['auto', '自動更新', 'クラウドから配信。更新中に録画が約5秒欠ける。1台のみの拠点向け。'],
          ] as const).map(([val, label, desc]) => (
            <button key={val} type="button" disabled={busy || edge.ota_mode === val}
                    onClick={() => void put({ ota_mode: val }, val === 'auto' ? '自動更新にしました' : '現地更新にしました')}
                    title={desc}
                    className={'flex-1 min-w-[180px] rounded border px-3 py-2 text-left text-xs ' + (
                      edge.ota_mode === val
                        ? 'border-blue-300 bg-blue-50 text-blue-900'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')}>
              <div className="font-semibold">{edge.ota_mode === val ? '● ' : '○ '}{label}</div>
              <div className="mt-0.5 text-[10px] font-normal text-slate-500">{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {edge.update_force && (
        <p className="mt-2 flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          即時更新フラグが立っています（時間帯を無視して適用・目標到達で自動解除）
          <button onClick={() => void put({ update_force: false }, '即時更新フラグを解除しました')}
                  disabled={busy} className="ml-auto rounded border border-amber-300 px-2 py-0.5 text-[10px]">
            解除
          </button>
        </p>
      )}

      {!isAuto && (
        <p className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          現地更新モードです。目標版を設定してもクラウドからは配信しません（拠点側は 204）。
          自動更新にすると下の設定が有効になります。
        </p>
      )}

      <div className={'mt-4 grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 md:grid-cols-3' + (isAuto ? '' : ' pointer-events-none opacity-40')}>
        <Field label="目標版（リリース台帳から選択・空=指示なし）">
          <select value={desired} onChange={(e) => setDesired(e.target.value)} disabled={!isAuto}
                  className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs">
            <option value="">— 指示なし —</option>
            {/* 台帳に無い既存値（手動設定の名残）も選択肢に残して保存できるようにする */}
            {edge.desired_agent_version && !releases?.some((r) => r.version === edge.desired_agent_version) && (
              <option value={edge.desired_agent_version}>{edge.desired_agent_version}（台帳未登録）</option>
            )}
            {versions.map((r) => (
              <option key={r.version} value={r.version}>
                {r.version}{hasPkg(r.version) ? '' : `（${pkg.format} / ${pkg.arch} 未登録）`}
              </option>
            ))}
          </select>
          {selectedMissing && (
            <p className="mt-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-700">
              この版には、この拠点の形式（<b>{pkg.format} / {pkg.arch}</b>）の配布物が未登録です。
              目標にしても拠点へは届きません。先に <a href="/admin/nvmsd-releases" className="underline">nvmsd リリース</a> で登録してください。
            </p>
          )}
          {releases !== null && releases.length === 0 && (
            <p className="mt-1 text-[10px] text-amber-700">
              リリースが未登録です。先に <a href="/admin/nvmsd-releases" className="underline">nvmsd リリース</a> で登録してください。
            </p>
          )}
          {downgradeLikely && (
            <p className="mt-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-[10px] text-red-700">
              この版は稼働版より前に登録されたものです。<b>「戻す」配備は拠点側で拒否され失敗します</b>
              （版を戻すには DB 復元を含む別手順が必要 — G・VMS と要相談）。
            </p>
          )}
        </Field>
        <Field label="更新時間帯 開始（JST・空=既定 02:00）">
          <input type="time" value={winStart} onChange={(e) => setWinStart(e.target.value)} disabled={!isAuto}
                 className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" />
        </Field>
        <Field label="更新時間帯 終了（JST・空=既定 05:00）">
          <input type="time" value={winEnd} onChange={(e) => setWinEnd(e.target.value)} disabled={!isAuto}
                 className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {msg && <span className="mr-auto text-xs text-emerald-700">{msg}</span>}
        <button onClick={forceNow} disabled={busy || !isAuto || !edge.desired_agent_version || !pending}
                title={!isAuto ? '自動更新モードのときだけ使えます' : pending ? '' : '目標版が未設定か、既に到達済みです'}
                className="rounded border border-slate-300 bg-white px-3 py-1 text-xs disabled:opacity-50">
          今すぐ更新（時間帯を無視）
        </button>
        <button onClick={save} disabled={busy || !isAuto || !dirty}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
          {busy ? '保存中…' : '保存'}
        </button>
      </div>
      <p className="mt-2 text-[10px] text-slate-400">
        nvmsd は <code>/api/edge/agent-update</code> を約10分間隔でポーリングし、時間帯内（既定 02:00〜05:00 JST）に
        G・VMS 署名を検証してから自己更新します。失敗時は旧版へ自動ロールバックし、同じ版へは再挑戦しません。
        <b>現在より古い版への「戻す」配備は拠点側で拒否されます</b>（失敗が記録に並ぶだけで拠点は壊れません）。
        検証拠点で「目標版で稼働中」を確認してから他拠点へ広げてください（段階配備）。
      </p>
    </section>
  )
}

const DIAG_STATUS: Record<DiagBundle['status'], { label: string; cls: string }> = {
  pending:   { label: '収集中', cls: 'bg-amber-100 text-amber-700' },
  completed: { label: '到着',   cls: 'bg-emerald-100 text-emerald-700' },
  failed:    { label: '失敗',   cls: 'bg-red-100 text-red-700' },
}

/**
 * 診断バンドル（DIAGNOSTICS_SPEC §2）: 発行 → nvmsd がログ一式を tar.gz で
 * アップロード → ここからダウンロード。未対応ビルドはコマンドを黙って
 * 読み飛ばすため、10 分待って収集中のままなら「未対応 or 収集失敗」と案内する。
 */
function DiagnosticsPanel({ edgeId, bundles }: { edgeId: string; bundles: DiagBundle[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function issue(maxBytes?: number) {
    setBusy(true); setMsg(null)
    const res = await fetch(`/api/admin/edges/${edgeId}/diagnostics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(maxBytes ? { max_bytes: maxBytes } : {}),
    })
    const j = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) {
      setMsg(j.error === 'command_pending'
        ? '別のコマンドが配信待ちです。数秒おいて再実行してください'
        : (j.error ?? `発行失敗: ${res.status}`))
      return
    }
    const capLabel = maxBytes && maxBytes < 1024 * 1024
      ? `${Math.round(maxBytes / 1024)} KiB`
      : maxBytes ? `${Math.round(maxBytes / 1024 / 1024)} MiB` : ''
    setMsg(maxBytes
      ? `上限 ${capLabel} で取得を発行しました（切り詰め確認）`
      : '取得を発行しました（通常は数分でここに現れます）')
    router.refresh()
  }

  const stalled = (b: DiagBundle) =>
    b.status === 'pending' && Date.now() - new Date(b.created_at).getTime() > 10 * 60_000

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-900">診断情報（G・VMS）</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            ログ・設定（秘匿値はマスク済み）・稼働状態の一式を取得します。映像は含まれません。保持 30 日。
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button onClick={() => void issue()} disabled={busy}
                  className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
            {busy ? '発行中…' : '診断情報を取得'}
          </button>
          {/* 切り詰め動作（古いログから落とす・DIAGNOSTICS_SPEC 基準5）を
              50 MiB 溜まるのを待たずに確認する。自然なバンドルは ~0.2MB のことが
              あるため、上限はそれより小さい 0.1 MiB にして確実に発動させる。 */}
          <button onClick={() => void issue(100 * 1024)} disabled={busy}
                  className="text-[10px] text-slate-500 underline disabled:opacity-50">
            上限 0.1 MiB で取得（切り詰め確認）
          </button>
        </div>
      </div>
      {msg && <p className="mb-2 text-xs text-emerald-700">{msg}</p>}

      {bundles.length === 0 ? (
        <p className="text-xs text-slate-400">取得履歴はまだありません。</p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            <tr>
              <th className="py-1.5 pr-3 text-left">発行日時</th>
              <th className="py-1.5 pr-3 text-left">状態</th>
              <th className="py-1.5 pr-3 text-right">サイズ</th>
              <th className="py-1.5 pr-3 text-left">備考</th>
              <th className="py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {bundles.map((b) => {
              const meta = DIAG_STATUS[b.status]
              return (
                <tr key={b.request_id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3 font-mono tabular-nums text-slate-600">
                    {new Date(b.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className={'rounded px-2 py-0.5 text-[11px] font-semibold ' + meta.cls}>{meta.label}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                    {b.bytes != null ? `${(b.bytes / 1024 / 1024).toFixed(1)} MB` : '—'}
                  </td>
                  <td className="py-1.5 pr-3 text-slate-500">
                    {b.status === 'failed' && (b.error ?? '収集失敗')}
                    {stalled(b) && '応答なし — nvmsd が未対応ビルドか、収集に失敗しています'}
                  </td>
                  <td className="py-1.5 text-right">
                    {b.status === 'completed' && (
                      <a href={`/api/admin/diagnostics/${b.request_id}/download`}
                         className="text-blue-600 hover:underline">ダウンロード</a>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}

/**
 * 設定の遠隔投入（CONFIG_PUSH_SPEC・A1）。nvms レコーダの desired_config を編集し、
 * 保存で config_version を +1。nvmsd が版の変化を見て適用し、applied_config_version を
 * heartbeat で報告する。desired と applied の一致で「反映済み」。
 */
function ConfigPushPanel({ recorder, appliedVersion }: { recorder: Recorder; appliedVersion: number | null }) {
  const router = useRouter()
  const cfg = (recorder.desired_config ?? {}) as Record<string, unknown>
  const [vals, setVals] = useState<Record<string, string>>({
    retention_days: cfg.retention_days != null ? String(cfg.retention_days) : '',
    live_hevc_passthrough: cfg.live_hevc_passthrough === true ? 'on' : cfg.live_hevc_passthrough === false ? 'off' : '',
    snapshot_offsets: Array.isArray(cfg.snapshot_offsets) ? (cfg.snapshot_offsets as number[]).join(',') : '',
  })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const version = recorder.config_version ?? 0
  const state = version === 0 ? { label: '未設定', cls: 'bg-slate-100 text-slate-600' }
    : appliedVersion === version ? { label: '反映済み', cls: 'bg-emerald-100 text-emerald-700' }
    : { label: '反映待ち', cls: 'bg-amber-100 text-amber-700' }

  function set(k: string, v: string) { setVals((s) => ({ ...s, [k]: v })) }

  // 保持日数を下げる変更は録画消去＝不可逆。nvmsd は拠点側の許可が無いと適用しない（付録A.3）。
  const prevRetention = typeof cfg.retention_days === 'number' ? cfg.retention_days : null
  const nextRetention = vals.retention_days.trim() ? Number(vals.retention_days) : null
  const retentionDecrease = prevRetention != null && nextRetention != null && nextRetention < prevRetention

  async function save() {
    if (retentionDecrease && !confirm(
      `保持日数を ${prevRetention} 日 → ${nextRetention} 日に下げます。\n`
      + '下げると古い録画が消え、取り消せません。\n'
      + '拠点側で許可（NVMS_REMOTE_RETENTION_DECREASE=true）が無い拠点では反映されず「反映待ち」のままになります。\n\n配信しますか？',
    )) return
    setBusy(true); setMsg(null); setErr(null)
    // 空欄のキーは送らない（＝そのキーは設定しない）。
    const body: Record<string, unknown> = {}
    if (vals.retention_days.trim()) body.retention_days = Number(vals.retention_days)
    if (vals.live_hevc_passthrough) body.live_hevc_passthrough = vals.live_hevc_passthrough === 'on'
    if (vals.snapshot_offsets.trim()) {
      const arr = vals.snapshot_offsets.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n))
      if (arr.length) body.snapshot_offsets = arr
    }
    try {
      const res = await fetch(`/api/admin/recorders/${recorder.id}/config`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error === 'invalid_config' ? '値の形式が不正です（範囲を確認してください）' : (j.error ?? `保存失敗: ${res.status}`))
      setMsg(`保存しました（版 ${j.config_version}・次回ポーリングで適用）`)
      router.refresh()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-bold text-slate-900">設定の遠隔投入</h2>
        <span className={'rounded px-2 py-0.5 text-[11px] font-semibold ' + state.cls}>{state.label}{version > 0 ? `（版 ${version}）` : ''}</span>
      </div>
      <p className="mb-3 text-[11px] text-slate-500">
        許可された設定だけをクラウドから配ります。空欄のキーは配信しません（現地の既定のまま）。
        保存すると版が上がり、nvmsd が次回ポーリングで適用します。
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block text-xs"><span className="mb-1 block font-medium text-slate-600">録画の保持日数（1〜3650）</span>
          <input value={vals.retention_days} onChange={(e) => set('retention_days', e.target.value.replace(/[^0-9]/g, ''))}
                 className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" placeholder="例: 30" />
          <span className={'mt-1 block text-[11px] ' + (retentionDecrease ? 'font-semibold text-amber-700' : 'text-slate-500')}>
            {retentionDecrease
              ? `${prevRetention} 日から下げる変更です。拠点側の許可が無いと反映されません（録画消去は取り消せません）`
              : '増やす変更はそのまま反映。下げる変更は拠点側の許可が必要です'}
          </span></label>
        <label className="block text-xs"><span className="mb-1 block font-medium text-slate-600">H.265 そのまま配信</span>
          <select value={vals.live_hevc_passthrough} onChange={(e) => set('live_hevc_passthrough', e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1 text-xs">
            <option value="">— 配信しない（現地既定）—</option>
            <option value="on">オン（そのまま配信）</option>
            <option value="off">オフ（サーバ変換）</option>
          </select></label>
        <label className="block text-xs"><span className="mb-1 block font-medium text-slate-600">BCP スナップ オフセット（分・各 −60〜60・カンマ区切り）</span>
          <input value={vals.snapshot_offsets} onChange={(e) => set('snapshot_offsets', e.target.value.replace(/[^0-9,\- ]/g, ''))}
                 className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs" placeholder="例: -5,5,10,30" /></label>
      </div>
      {state.label === '反映待ち' && recorder.config_rejected.length > 0 && (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          <p className="mb-1 font-semibold">拠点が受け付けなかった設定（最新の死活報告より）</p>
          <ul className="space-y-0.5">
            {recorder.config_rejected.map((r, i) => (
              <li key={i}><span className="font-mono">{r.key}</span>{r.reason ? `: ${r.reason}` : ''}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex items-center justify-end gap-3">
        {err && <span className="mr-auto text-xs text-red-700">{err}</span>}
        {msg && !err && <span className="mr-auto text-xs text-emerald-700">{msg}</span>}
        <button onClick={save} disabled={busy}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
          {busy ? '保存中…' : '設定を配信'}
        </button>
      </div>
    </section>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[100px_1fr]">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-900">{v}</dd>
    </div>
  )
}

function RecorderList({ edgeId, recorders }: { edgeId: string; recorders: Recorder[] }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)

  async function addRecorder(form: NewRecorder) {
    const res = await fetch('/api/admin/recorders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edge_id: edgeId, ...form }),
    })
    if (res.ok) { setAdding(false); router.refresh() }
    else alert(`登録失敗: ${res.status}`)
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 text-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-bold text-slate-900">レコーダ ({recorders.length})</h2>
        <button onClick={() => setAdding(true)}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700">
          ＋ レコーダ追加
        </button>
      </div>

      {adding && <NewRecorderForm onCancel={() => setAdding(false)} onSubmit={addRecorder} />}

      <div className="space-y-3">
        {recorders.map((r) => (
          <RecorderCard key={r.id} recorder={r} />
        ))}
        {recorders.length === 0 && !adding && (
          <p className="rounded border border-dashed border-slate-300 py-6 text-center text-xs text-slate-400">
            レコーダが未登録です。「＋ レコーダ追加」から登録してください。
          </p>
        )}
      </div>
    </section>
  )
}

type NewRecorder = {
  vendor: 'ipro' | 'frigate' | 'onvif-generic' | 'i-pro-nvr' | 'nvms'
  model: string
  host: string
  rtsp_port: number
  onvif_port: number | null
  username: string
  password: string
  notes: string
}

const VENDOR_DEFAULTS: Record<NewRecorder['vendor'], Partial<NewRecorder>> = {
  ipro:             { rtsp_port: 554,  username: 'admin', password: '' },
  frigate:          { rtsp_port: 8554, username: '',      password: '' },
  // カメラ直 ONVIF: ONVIF は通常 80、RTSP は 554。1行=1カメラ。
  'onvif-generic':  { rtsp_port: 554,  onvif_port: 80, username: 'admin', password: '' },
  // i-PRO NVR 経由: host=NVRのIP。ライブ=push.cgi / VOD=httpdl.cgi。
  // ユーザ名は **NVR 本体の管理者(既定 ADMIN)**。カメラ側の admin を入れると
  // dlogin.cgi が 401 になり、ライブが一切出ない（2026-08-06 実機で踏んだ）。
  // ポートは NVR の HTTPS ポート（既定 443）。
  'i-pro-nvr':      { rtsp_port: 554,  onvif_port: 443, username: 'ADMIN', password: '' },
  // NVMS(自社オンプレVMS) 経由: host=NVMSのIP(:ポート。省略時 8080)。認証は API キーのみ
  // （パスワード欄に入れる。**operator 権限で発行** — 範囲エクスポートに必要）。
  // username は未使用（'api' 固定で埋める）。RTSP/ONVIF ポートも未使用。
  nvms:             { rtsp_port: 554,  onvif_port: null, username: 'api', password: '' },
}

/** ONVIF ポート欄の意味はベンダで変わる（i-PRO NVR は CGI を叩く HTTPS ポート）。 */
function portLabel(v: NewRecorder['vendor']): string {
  if (v === 'i-pro-nvr') return 'NVR HTTPS ポート'
  if (v === 'nvms')      return '（未使用・ポートはホスト欄に）'
  return 'ONVIF ポート (任意)'
}

function vendorLabel(v: NewRecorder['vendor']) {
  if (v === 'ipro')           return 'i-PRO'
  if (v === 'frigate')        return 'Frigate (OSS-VMS)'
  if (v === 'onvif-generic')  return 'ONVIFカメラ直'
  if (v === 'i-pro-nvr')      return 'i-PRO NVR(レコーダ経由)'
  if (v === 'nvms')           return 'NVMS(自社オンプレVMS)'
  // 想定外の値は素の値を出す。以前ここは 'Uniview' を返すフォールバックで、
  // uniview を消した後は**未知のベンダが全部 Uniview と表示される**形だった。
  return v
}

function NewRecorderForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (r: NewRecorder) => void
  onCancel: () => void
}) {
  const [r, setR] = useState<NewRecorder>({
    // 既定は本番で最も使われている ONVIF カメラ直。以前は uniview が既定で、
    // 登録画面を開くと最初から実装の無いベンダが選ばれていた。
    vendor: 'onvif-generic', model: '', host: '', rtsp_port: 554, onvif_port: 80,
    username: 'admin', password: '', notes: '',
  })

  function changeVendor(v: NewRecorder['vendor']) {
    setR((prev) => ({ ...prev, vendor: v, ...VENDOR_DEFAULTS[v] }))
  }

  const isFrigate = r.vendor === 'frigate'
  const canSubmit = !!r.host && (isFrigate || (!!r.username && !!r.password))

  return (
    <div className="mb-3 rounded border border-blue-200 bg-blue-50 p-3 text-xs">
      <h3 className="mb-2 font-bold text-blue-900">レコーダ新規登録</h3>
      <div className="grid grid-cols-4 gap-2">
        <Field label="ベンダ">
          <select value={r.vendor} onChange={(e) => changeVendor(e.target.value as NewRecorder['vendor'])}
                  className="w-full rounded border border-slate-300 px-2 py-1">
            <option value="onvif-generic">ONVIFカメラ直</option>
            <option value="ipro">i-PRO</option>
            <option value="i-pro-nvr">i-PRO NVR(レコーダ経由)</option>
            <option value="frigate">Frigate (OSS-VMS)</option>
            <option value="nvms">NVMS(自社オンプレVMS)</option>
          </select>
        </Field>
        <Field label="機種 / メモ">
          <input value={r.model} onChange={(e) => setR({ ...r, model: e.target.value })}
                 className="w-full rounded border border-slate-300 px-2 py-1"
                 placeholder={isFrigate ? 'Frigate 等' : 'WJ-NX410 等'} />
        </Field>
        <Field label="ホスト (IP)">
          <input required value={r.host} onChange={(e) => setR({ ...r, host: e.target.value })}
                 className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
                 placeholder="192.168.1.10" />
        </Field>
        <Field label={isFrigate ? 'RTSP ポート (mediamtx)' : 'RTSP ポート'}>
          <input type="number" value={r.rtsp_port}
                 onChange={(e) => setR({ ...r, rtsp_port: Number(e.target.value) })}
                 className="w-full rounded border border-slate-300 px-2 py-1 font-mono" />
        </Field>
        {!isFrigate && (
          <Field label={portLabel(r.vendor)}>
            <input type="number" value={r.onvif_port ?? ''}
                   onChange={(e) => setR({ ...r, onvif_port: e.target.value === '' ? null : Number(e.target.value) })}
                   className="w-full rounded border border-slate-300 px-2 py-1 font-mono" />
          </Field>
        )}
        {!isFrigate && (
          <Field label="ユーザ名">
            <input required value={r.username} onChange={(e) => setR({ ...r, username: e.target.value })}
                   className="w-full rounded border border-slate-300 px-2 py-1" />
          </Field>
        )}
        {!isFrigate && (
          <Field label={r.vendor === 'nvms' ? 'API キー (operator)' : 'パスワード'}>
            <input required type="password" value={r.password}
                   onChange={(e) => setR({ ...r, password: e.target.value })}
                   className="w-full rounded border border-slate-300 px-2 py-1" />
          </Field>
        )}
        {isFrigate && (
          <Field label="備考">
            <input value={r.notes} onChange={(e) => setR({ ...r, notes: e.target.value })}
                   className="w-full rounded border border-slate-300 px-2 py-1"
                   placeholder="Frigate の URL などを記録" />
          </Field>
        )}
        {!isFrigate && (
          <Field label="メモ">
            <input value={r.notes} onChange={(e) => setR({ ...r, notes: e.target.value })}
                   className="w-full rounded border border-slate-300 px-2 py-1" />
          </Field>
        )}
      </div>
      {r.vendor === 'nvms' && (
        <p className="mt-2 rounded bg-amber-50 border border-amber-200 px-2 py-1.5 text-[10px] text-amber-800">
          ホストは NVMS のIP（ポート省略時は <code>8080</code>。<code>192.168.1.10:8080</code> の形で指定可）。
          <b>パスワード欄には NVMS の API キー</b>（設定 › API キーで <b>operator 権限</b>で発行）を入れます。
          録画クリップの取得（範囲エクスポート）が operator 以上のためで、viewer キーではライブは映っても録画が 403 になります。
          ユーザ名・RTSP/ONVIF ポートは使いません。クラスタ構成では窓口 1 ノードの IP で全カメラを取得できます。
        </p>
      )}
      {r.vendor === 'i-pro-nvr' && (
        <p className="mt-2 rounded bg-amber-50 border border-amber-200 px-2 py-1.5 text-[10px] text-amber-800">
          ユーザ名は <b>NVR 本体の管理者</b>（既定 <code>ADMIN</code>）です。カメラ側のユーザを入れるとログインに失敗し、
          ライブが表示されません。ホストは NVR の IP、ポートは NVR の HTTPS ポート（既定 443）を指定します。
        </p>
      )}
      {isFrigate && (
        <p className="mt-2 rounded bg-amber-50 border border-amber-200 px-2 py-1.5 text-[10px] text-amber-800">
          Frigate は認証なしで接続します。カメラごとのストリーム名 (例: <code>camera_01</code>) は、
          下のカメラ一覧の「Frigate カメラ名」列で設定してください。未設定の場合は ch 番号から自動生成されます。
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded border border-slate-300 bg-white px-3 py-1 text-xs">
          キャンセル
        </button>
        <button onClick={() => onSubmit(r)}
                disabled={!canSubmit}
                className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
          登録
        </button>
      </div>
    </div>
  )
}

type OnvifProfile = { token: string; name: string; encoding: string | null }
type DiscoveryResult = {
  device: { manufacturer?: string; model?: string; firmwareVersion?: string } | null
  profiles: OnvifProfile[]
  count: number
}
type ConnResult = { ok: boolean; bytes?: number; error?: string }

/** edge_jobs を done/error まで2秒間隔でポーリング（最大45秒）。 */
async function pollEdgeJob(jobId: string, timeoutMs = 45_000): Promise<{ status: string; result: unknown; error: string | null }> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`/api/admin/edge-jobs/${jobId}`)
    if (res.ok) {
      const j = await res.json() as { status: string; result: unknown; error: string | null }
      if (j.status === 'done' || j.status === 'error') return j
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  return { status: 'timeout', result: null, error: 'タイムアウト（エッジ未応答）' }
}

function RecorderCard({ recorder }: { recorder: Recorder }) {
  const router = useRouter()
  const [cams, setCams]   = useState<Camera[]>(
    [...recorder.recorder_cameras].sort((a, b) => a.channel - b.channel)
  )
  const [busy, setBusy]   = useState(false)
  const [msg,  setMsg]    = useState<string | null>(null)

  // 詳細設定（ライブ/VOD/go2rtc）— 従来 SQL 直編集だったフィールドの開閉式編集。
  const [showDetail, setShowDetail] = useState(false)
  const [rec, setRec] = useState({
    // 接続設定（作成後に変更できないと現地でのパスワードローテができない）
    host:         recorder.host,
    rtsp_port:    recorder.rtsp_port.toString(),
    onvif_port:   recorder.onvif_port?.toString() ?? '',
    username:     recorder.username,
    password:     '',                                   // 書込専用。空欄=現状維持
    live_host:    recorder.live_host ?? '',
    vod_host:     recorder.vod_host ?? '',
    vod_username: recorder.vod_username ?? '',
    vod_password: '',                                   // 書込専用。空欄=現状維持
    vod_channel:  recorder.vod_channel?.toString() ?? '',
  })
  const [recBusy, setRecBusy] = useState(false)
  const [recMsg,  setRecMsg]  = useState<string | null>(null)

  // Phase 2b（nvms のみ）: BCP 収集方式と対象フォルダ。null = 全フォルダ。
  const [bcpMode, setBcpMode] = useState<'grid' | 'per_camera'>(recorder.bcp_capture_mode ?? 'grid')
  const [bcpFolders, setBcpFolders] = useState<string[] | null>(recorder.bcp_folder_paths)
  const bcpFolderChoices = [...new Set(
    recorder.recorder_cameras.map((c) => c.folder_path).filter((f): f is string => !!f),
  )].sort((a, b) => a.localeCompare(b, 'ja'))
  function toggleBcpFolder(f: string) {
    setBcpFolders((prev) => {
      const cur = prev ?? []
      return cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f]
    })
  }

  async function saveRecorder() {
    setRecBusy(true); setRecMsg(null)
    const body: Record<string, unknown> = {
      host:         rec.host,
      rtsp_port:    Number(rec.rtsp_port),
      onvif_port:   rec.onvif_port === '' ? null : Number(rec.onvif_port),
      username:     rec.username,
      live_host:    rec.live_host,
      vod_host:     rec.vod_host,
      vod_username: rec.vod_username,
      vod_channel:  rec.vod_channel === '' ? null : Number(rec.vod_channel),
    }
    if (rec.password)     body.password     = rec.password       // 非空のみ更新
    if (rec.vod_password) body.vod_password = rec.vod_password   // 非空のみ更新
    if (recorder.vendor === 'nvms') {
      body.bcp_capture_mode = bcpMode
      // 「全フォルダ」= null。選択モードで 0 件は事故（証跡ゼロ）なので null に倒す。
      body.bcp_folder_paths = bcpFolders && bcpFolders.length > 0 ? bcpFolders : null
    }
    const res = await fetch(`/api/admin/recorders/${recorder.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setRecBusy(false)
    if (!res.ok) { const j = await res.json().catch(() => ({})); setRecMsg(j.error ?? `保存失敗: ${res.status}`); return }
    setRecMsg('保存しました'); setRec((p) => ({ ...p, password: '', vod_password: '' })); router.refresh()
  }

  // Stage 2b: ONVIF探索 / 接続テスト（エッジ経由・ジョブをポーリング）。
  const [jobBusy, setJobBusy]       = useState(false)
  const [jobMsg, setJobMsg]         = useState<string | null>(null)
  const [discovery, setDiscovery]   = useState<DiscoveryResult | null>(null)
  const [connResult, setConnResult] = useState<ConnResult | null>(null)

  async function discover() {
    setJobBusy(true); setJobMsg('ONVIF探索中…（最大45秒）'); setDiscovery(null)
    try {
      const r = await fetch(`/api/admin/recorders/${recorder.id}/discover`, { method: 'POST' })
      if (!r.ok) { const j = await r.json().catch(() => ({})); setJobMsg(j.error ?? '探索開始失敗'); return }
      const { job_id } = await r.json() as { job_id: string }
      const j = await pollEdgeJob(job_id)
      if (j.status === 'done') { setDiscovery(j.result as DiscoveryResult); setJobMsg(null) }
      else setJobMsg(`探索失敗: ${j.error ?? j.status}`)
    } finally { setJobBusy(false) }
  }

  async function connTest() {
    setJobBusy(true); setJobMsg('接続テスト中…'); setConnResult(null)
    try {
      const r = await fetch(`/api/admin/recorders/${recorder.id}/conn-test`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); setJobMsg(j.error ?? 'テスト開始失敗'); return }
      const { job_id } = await r.json() as { job_id: string }
      const j = await pollEdgeJob(job_id)
      if (j.status === 'done') { setConnResult(j.result as ConnResult); setJobMsg(null) }
      else setJobMsg(`テスト失敗: ${j.error ?? j.status}`)
    } finally { setJobBusy(false) }
  }

  /** 探索プロファイルから名前指定でカメラ行を1つ追加（grid 未使用位置へ）。 */
  function addCamNamed(camName: string) {
    const maxCh   = Math.max(0, ...cams.map((c) => c.channel))
    const usedPos = new Set(cams.filter((c) => !c._del).map((c) => c.grid_pos))
    const nextPos = [...Array(16).keys()].find((i) => !usedPos.has(i)) ?? 0
    setCams((cs) => [...cs, { channel: maxCh + 1, name: camName || `ch${maxCh + 1}`, grid_pos: nextPos, enabled: true, frigate_camera: null, hls_url: null, live_rtsp: null, _new: true }])
  }

  const colCount = 5 + (recorder.vendor === 'frigate' ? 1 : 0) + (showDetail ? 2 : 0)

  function update(idx: number, patch: Partial<Camera>) {
    setCams((cs) => cs.map((c, i) => i === idx ? { ...c, ...patch, _dirty: !c._new } : c))
  }
  function addCam() {
    const maxCh   = Math.max(0, ...cams.map((c) => c.channel))
    const usedPos = new Set(cams.filter((c) => !c._del).map((c) => c.grid_pos))
    const nextPos = [...Array(16).keys()].find((i) => !usedPos.has(i)) ?? 0
    setCams((cs) => [...cs, { channel: maxCh + 1, name: `ch${maxCh + 1}`, grid_pos: nextPos, enabled: true, frigate_camera: null, hls_url: null, live_rtsp: null, _new: true }])
  }
  function removeCam(idx: number) {
    setCams((cs) => cs.map((c, i) => i === idx ? { ...c, _del: true } : c))
  }

  async function save() {
    setBusy(true); setMsg(null)
    const payload = {
      upsert: cams.filter((c) => !c._del && (c._new || c._dirty)),
      delete: cams.filter((c) => c._del && c.id).map((c) => c.id!),
    }
    const res = await fetch(`/api/admin/recorders/${recorder.id}/cameras`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(false)
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setMsg(j.error ?? `保存失敗: ${res.status}`)
      return
    }
    setMsg('保存しました')
    router.refresh()
  }

  async function deleteRec() {
    if (!confirm(`レコーダ ${recorder.host} を削除しますか？`)) return
    const res = await fetch(`/api/admin/recorders/${recorder.id}`, { method: 'DELETE' })
    if (res.ok) router.refresh()
    else alert(`削除失敗: ${res.status}`)
  }

  // ── 大規模カメラ向けの絞り込み（Phase 1.5 M2）─────────────────────
  // nvms（同期で数百〜数万台になりうる）または 50 台超のとき、検索・フォルダ・
  // ページングを出す。従来の少数台構成では何も変わらない。
  const [q, setQ]               = useState('')
  const [folderSel, setFolderSel] = useState('')
  const [camPage, setCamPage]   = useState(0)
  const CAM_PAGE_SIZE = 50
  const bigList = recorder.vendor === 'nvms' || cams.length > CAM_PAGE_SIZE

  const alive = cams.filter((c) => !c._del)
  const folders = [...new Set(alive.map((c) => c.folder_path).filter((f): f is string => !!f))]
    .sort((a, b) => a.localeCompare(b, 'ja'))
  const filtered = !bigList ? alive : alive.filter((c) => {
    if (folderSel && (c.folder_path ?? '') !== folderSel) return false
    if (!q) return true
    const needle = q.toLowerCase()
    return c.name.toLowerCase().includes(needle)
      || (c.folder_path ?? '').toLowerCase().includes(needle)
      || String(c.channel).includes(needle)
  })
  const camPages = Math.max(1, Math.ceil(filtered.length / CAM_PAGE_SIZE))
  const camPageClamped = Math.min(camPage, camPages - 1)
  const visible = bigList
    ? filtered.slice(camPageClamped * CAM_PAGE_SIZE, (camPageClamped + 1) * CAM_PAGE_SIZE)
    : filtered

  return (
    <div className="rounded border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="text-xs">
          <span className="font-bold">{vendorLabel(recorder.vendor)}</span>
          <span className="ml-2 text-slate-500">{recorder.model ?? '—'}</span>
          <span className="ml-2 font-mono text-slate-700">{recorder.host}:{recorder.rtsp_port}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowDetail((v) => !v)}
                  className={'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs ' + (showDetail ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white')}>
            {showDetail ? '詳細を隠す' : <><Settings size={14} strokeWidth={1.5} aria-hidden /> 詳細(ライブ/VOD/go2rtc)</>}
          </button>
          <button onClick={addCam} className="rounded bg-white border border-slate-200 px-2 py-0.5 text-xs">＋ カメラ</button>
          <button onClick={deleteRec} className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-0.5 text-xs text-red-700"><Trash2 size={14} strokeWidth={1.5} aria-hidden /> 削除</button>
        </div>
      </div>

      {/* 詳細設定パネル（ライブ/VOD）— 従来 SQL 直編集だったレコーダ単位フィールド */}
      {showDetail && (
        <div className="border-b border-slate-200 bg-slate-50/50 px-3 py-3">
          {/* 接続設定 — 登録後も変更できないと現地のパスワードローテに追従できない */}
          <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3">
            <Field label="ホスト (IP)">
              <input value={rec.host} onChange={(e) => setRec({ ...rec, host: e.target.value })}
                     className="w-full rounded border border-slate-300 px-2 py-1 font-mono" placeholder="192.168.0.10" />
            </Field>
            <Field label="RTSP ポート">
              <input type="number" value={rec.rtsp_port} onChange={(e) => setRec({ ...rec, rtsp_port: e.target.value })}
                     className="w-full rounded border border-slate-300 px-2 py-1 font-mono" />
            </Field>
            <Field label={portLabel(recorder.vendor)}>
              <input type="number" value={rec.onvif_port} onChange={(e) => setRec({ ...rec, onvif_port: e.target.value })}
                     className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
                     placeholder={recorder.vendor === 'i-pro-nvr' ? '443' : '80'} />
            </Field>
            <Field label={recorder.vendor === 'i-pro-nvr' ? 'ユーザ名 (NVR本体・既定 ADMIN)' : recorder.vendor === 'nvms' ? 'ユーザ名（NVMSでは未使用）' : 'ユーザ名'}>
              <input value={rec.username} onChange={(e) => setRec({ ...rec, username: e.target.value })}
                     className="w-full rounded border border-slate-300 px-2 py-1" placeholder="admin" />
            </Field>
            <Field label={`パスワード${recorder.has_password ? '（設定済・変更時のみ入力）' : '（未設定）'}`}>
              <input type="password" value={rec.password} onChange={(e) => setRec({ ...rec, password: e.target.value })}
                     className="w-full rounded border border-slate-300 px-2 py-1"
                     placeholder={recorder.has_password ? '••••••（変更しない場合は空欄）' : ''} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-3">
            <Field label="ライブ host:port (Frigate iframe)">
              <input value={rec.live_host} onChange={(e) => setRec({ ...rec, live_host: e.target.value })}
                     className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
                     placeholder="192.168.0.100:5000" />
            </Field>
            <Field label="VOD元 host (NVR HTTPS)">
              <input value={rec.vod_host} onChange={(e) => setRec({ ...rec, vod_host: e.target.value })}
                     className="w-full rounded border border-slate-300 px-2 py-1 font-mono"
                     placeholder="https://192.168.0.10:443" />
            </Field>
            <Field label="VOD チャンネル">
              <input type="number" min={1} max={64} value={rec.vod_channel}
                     onChange={(e) => setRec({ ...rec, vod_channel: e.target.value })}
                     className="w-full rounded border border-slate-300 px-2 py-1 font-mono" placeholder="1" />
            </Field>
            <Field label="VOD ユーザ名">
              <input value={rec.vod_username} onChange={(e) => setRec({ ...rec, vod_username: e.target.value })}
                     className="w-full rounded border border-slate-300 px-2 py-1" placeholder="admin" />
            </Field>
            <Field label={`VOD パスワード${recorder.vod_has_password ? '（設定済・変更時のみ入力）' : '（未設定）'}`}>
              <input type="password" value={rec.vod_password} onChange={(e) => setRec({ ...rec, vod_password: e.target.value })}
                     className="w-full rounded border border-slate-300 px-2 py-1"
                     placeholder={recorder.vod_has_password ? '••••••（変更しない場合は空欄）' : ''} />
            </Field>
          </div>
          {/* Phase 2b: BCP 証跡の方式と対象フォルダ（nvms のみ・UPLINK_CLIPS_SPEC.md §6） */}
          {recorder.vendor === 'nvms' && (
            <div className="mt-3 rounded border border-slate-200 bg-white p-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">BCP 証跡（NVMS）</p>
              <div className="flex flex-wrap gap-4 text-xs">
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name={`bcpmode-${recorder.id}`} checked={bcpMode === 'grid'}
                         onChange={() => setBcpMode('grid')} />
                  合成（16分割・既定）
                </label>
                <label className="inline-flex items-center gap-1.5">
                  <input type="radio" name={`bcpmode-${recorder.id}`} checked={bcpMode === 'per_camera'}
                         onChange={() => setBcpMode('per_camera')} />
                  カメラ個別（対象を絞った運用向け）
                </label>
              </div>
              <div className="mt-2 text-xs">
                <label className="inline-flex items-center gap-1.5">
                  <input type="checkbox" checked={bcpFolders === null}
                         onChange={(e) => setBcpFolders(e.target.checked ? null : [])} />
                  全フォルダを対象にする
                </label>
                {bcpFolders !== null && (
                  bcpFolderChoices.length === 0 ? (
                    <p className="mt-1.5 text-[11px] text-slate-400">フォルダは NVMS からの同期後に選択できます（未分類のみの場合は「全フォルダ」を使ってください）。</p>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                      {bcpFolderChoices.map((f) => (
                        <label key={f} className="inline-flex items-center gap-1.5">
                          <input type="checkbox" checked={bcpFolders.includes(f)} onChange={() => toggleBcpFolder(f)} />
                          {f}
                        </label>
                      ))}
                    </div>
                  )
                )}
              </div>
              <p className="mt-2 text-[10px] text-slate-400">
                発報時の証跡は 1 イベントあたり最大 512 枚（合成 64 ページ / 個別 64 台 × 8 時点）で打ち切られます。
                対象を選択しても 0 件のまま保存すると「全フォルダ」に戻ります。
              </p>
            </div>
          )}

          <div className="mt-2 flex items-center justify-end gap-2">
            {recMsg && <span className="text-xs text-emerald-700">{recMsg}</span>}
            <button onClick={saveRecorder} disabled={recBusy}
                    className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50">
              {recBusy ? '保存中…' : 'レコーダ設定を保存'}
            </button>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">
            下のカメラ表の「HLS URL / live RTSP」列も go2rtc 高画質ライブの個別設定です（保存は「カメラを保存」）。
          </p>

          {/* Stage 2b: ONVIF探索 / 接続テスト（エッジ経由） */}
          <div className="mt-3 border-t border-slate-200 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={discover} disabled={jobBusy}
                      className="inline-flex items-center gap-1 rounded border border-blue-300 bg-white px-3 py-1 text-xs font-medium text-blue-700 disabled:opacity-50">
                <Search size={14} strokeWidth={1.5} aria-hidden /> ONVIF探索
              </button>
              <button onClick={connTest} disabled={jobBusy}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-1 text-xs disabled:opacity-50">
                <Plug size={14} strokeWidth={1.5} aria-hidden /> 接続テスト
              </button>
              {jobMsg && <span className="text-xs text-slate-500">{jobMsg}</span>}
              {connResult && (
                <span className={'rounded px-2 py-0.5 text-[11px] font-semibold ' + (connResult.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
                  {connResult.ok ? `到達OK (${connResult.bytes ?? 0}B)` : `到達NG: ${connResult.error ?? 'unknown'}`}
                </span>
              )}
            </div>
            <p className="mt-1 text-[10px] text-slate-400">
              探索/テストは現地エッジが LAN 内で実行します（エッジがオフラインだと結果が返りません）。
            </p>

            {discovery && (
              <div className="mt-2 rounded border border-slate-200 bg-white p-2">
                <div className="mb-1 text-[11px] text-slate-600">
                  {discovery.device?.manufacturer || '—'} {discovery.device?.model || ''}
                  <span className="ml-2 text-slate-400">プロファイル {discovery.count} 件</span>
                </div>
                <ul className="space-y-1">
                  {discovery.profiles.map((p) => (
                    <li key={p.token} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1">
                      <span className="font-mono text-[10px] text-slate-600">
                        {p.name}{p.encoding ? <span className="ml-1 rounded bg-slate-200 px-1 text-slate-500">{p.encoding}</span> : null}
                      </span>
                      <button onClick={() => addCamNamed(p.name)}
                              className="shrink-0 rounded bg-blue-600 px-2 py-0.5 text-[10px] font-medium text-white">
                        ＋ カメラ追加
                      </button>
                    </li>
                  ))}
                  {discovery.profiles.length === 0 && <li className="text-[11px] text-slate-400">プロファイルが見つかりませんでした</li>}
                </ul>
                <p className="mt-1 text-[10px] text-slate-400">追加後、ch/grid位置を調整して「カメラを保存」してください。</p>
              </div>
            )}
          </div>
        </div>
      )}
      {recorder.vendor === 'nvms' && (
        <p className="border-b border-slate-100 bg-blue-50/60 px-3 py-1.5 text-[10px] text-slate-600">
          カメラは NVMS から<b>自動同期</b>されます（10 分ごと・エッジ経由）。名前・フォルダ・有効/無効は
          NVMS 側の変更が優先され、ここでの編集は次回同期で上書きされます。ch = NVMS のカメラ ID です。
        </p>
      )}
      {bigList && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-xs">
          <input value={q} onChange={(e) => { setQ(e.target.value); setCamPage(0) }}
                 placeholder="カメラ名・フォルダ・ch で検索"
                 className="w-56 rounded border border-slate-200 px-2 py-1" />
          {folders.length > 0 && (
            <select value={folderSel} onChange={(e) => { setFolderSel(e.target.value); setCamPage(0) }}
                    className="max-w-[16rem] rounded border border-slate-200 px-2 py-1">
              <option value="">すべてのフォルダ</option>
              {folders.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          <span className="ml-auto font-mono text-[11px] tabular-nums text-slate-500">
            {filtered.length.toLocaleString()} 台
          </span>
          {camPages > 1 && (
            <span className="flex items-center gap-1 font-mono text-[11px] tabular-nums text-slate-600">
              <button onClick={() => setCamPage((v) => Math.max(0, v - 1))}
                      className="rounded border border-slate-200 px-1.5 py-0.5">◀</button>
              {camPageClamped + 1} / {camPages}
              <button onClick={() => setCamPage((v) => Math.min(camPages - 1, v + 1))}
                      className="rounded border border-slate-200 px-1.5 py-0.5">▶</button>
            </span>
          )}
        </div>
      )}
      <table className="w-full text-xs">
        <thead className="bg-slate-50/60 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          <tr>
            <th className="px-2 py-1.5 text-left w-14">ch</th>
            <th className="px-2 py-1.5 text-left">カメラ名</th>
            {recorder.vendor === 'nvms' && (
              <th className="px-2 py-1.5 text-left w-44">フォルダ (NVMS)</th>
            )}
            {recorder.vendor === 'frigate' && (
              <th className="px-2 py-1.5 text-left w-36">Frigate カメラ名</th>
            )}
            <th className="px-2 py-1.5 text-left w-24">grid 位置</th>
            <th className="px-2 py-1.5 text-left w-16">有効</th>
            {showDetail && <th className="px-2 py-1.5 text-left">HLS URL (go2rtc)</th>}
            {showDetail && <th className="px-2 py-1.5 text-left">live RTSP</th>}
            <th className="px-2 py-1.5 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((c, i) => {
            const realIdx = cams.indexOf(c)
            return (
              <tr key={c.id ?? `new-${i}`} className="border-t border-slate-100">
                <td className="px-2 py-1">
                  <input type="number" value={c.channel} min={1}
                         max={recorder.vendor === 'nvms' ? undefined : 64}
                         onChange={(e) => update(realIdx, { channel: Number(e.target.value) })}
                         className="w-12 rounded border border-slate-200 px-1 py-0.5 font-mono" />
                </td>
                <td className="px-2 py-1">
                  <input value={c.name} onChange={(e) => update(realIdx, { name: e.target.value })}
                         className="w-full rounded border border-slate-200 px-1 py-0.5" />
                </td>
                {recorder.vendor === 'nvms' && (
                  <td className="px-2 py-1 text-[10px] text-slate-500">{c.folder_path ?? '—'}</td>
                )}
                {recorder.vendor === 'frigate' && (
                  <td className="px-2 py-1">
                    <input value={c.frigate_camera ?? ''}
                           onChange={(e) => update(realIdx, { frigate_camera: e.target.value || null })}
                           className="w-full rounded border border-slate-200 px-1 py-0.5 font-mono"
                           placeholder={`camera_${String(c.channel).padStart(2, '0')}`} />
                  </td>
                )}
                <td className="px-2 py-1">
                  <select value={c.grid_pos} onChange={(e) => update(realIdx, { grid_pos: Number(e.target.value) })}
                          className="rounded border border-slate-200 px-1 py-0.5">
                    {[...Array(16).keys()].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1">
                  <input type="checkbox" checked={c.enabled}
                         onChange={(e) => update(realIdx, { enabled: e.target.checked })} />
                </td>
                {showDetail && (
                  <td className="px-2 py-1">
                    <input value={c.hls_url ?? ''}
                           onChange={(e) => update(realIdx, { hls_url: e.target.value || null })}
                           className="w-full min-w-[180px] rounded border border-slate-200 px-1 py-0.5 font-mono text-[10px]"
                           placeholder="https://…/stream.m3u8?src=cam_…" />
                  </td>
                )}
                {showDetail && (
                  <td className="px-2 py-1">
                    <input value={c.live_rtsp ?? ''}
                           onChange={(e) => update(realIdx, { live_rtsp: e.target.value || null })}
                           className="w-full min-w-[180px] rounded border border-slate-200 px-1 py-0.5 font-mono text-[10px]"
                           placeholder="rtsp://… または /path" />
                  </td>
                )}
                <td className="px-2 py-1 text-right">
                  <button onClick={() => removeCam(realIdx)} className="inline-flex text-red-600" aria-label="削除"><X size={14} strokeWidth={1.5} aria-hidden /></button>
                </td>
              </tr>
            )
          })}
          {visible.length === 0 && (
            <tr><td colSpan={colCount} className="px-2 py-3 text-center text-slate-400">カメラ未登録</td></tr>
          )}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-3 py-2 text-xs">
        {msg ? <span className="text-emerald-700">{msg}</span> : <span />}
        <button onClick={save} disabled={busy}
                className="rounded bg-blue-600 px-3 py-1 font-medium text-white disabled:opacity-50">
          {busy ? '保存中…' : 'カメラを保存'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  )
}
