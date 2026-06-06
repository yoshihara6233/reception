'use client'

/**
 * Central workspace — 16分割グリッド表示 + ツールバー
 *
 * Desktop: 4×4 grid (aspect-video)
 * Mobile:  2×2 scrollable grid (より大きく・タップしやすく)
 *
 * All UI text is sourced from the i18n context.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLang } from '@/lib/i18n/context'
import {
  isVodVendor,
  VOD_RANGE_MAX_MIN_BY_VENDOR,
  type RecorderVendor,
  type VodVendor,
} from '@/lib/types/db'
import { cancelPendingStop, scheduleStop } from '@/lib/edge-stop-registry'

// Cadence for re-fetching the stitched grid JPEG. Edge uploads at ~0.5 fps
// (one frame every ~2s); a 5s viewer cadence keeps the bandwidth low and
// matches the "occasional check" use case rather than "real-time monitor".
const REFRESH_MS = 5000

// The store has no per-store timezone column yet, so we treat the entered
// wall-clock as Asia/Tokyo (+09:00, no DST).
const STORE_TZ_OFFSET = '+09:00'
const VOD_RANGE_DEFAULT_MIN = 5

// F30 → F75: pending stop_grid is now managed by the shared edge-stop
// registry (lib/edge-stop-registry.ts) so a cross-mode mount (/live)
// can also cancel a pending stop_grid for the same edge. The previous
// local PENDING_GRID_STOPS map only cancelled within /grid — meaning
// /grid → /live raced and the live snapshot froze.
const GRID_STOP_DELAY_MS = 200

type Cam = { id: string; channel: number; name: string; grid_pos: number; vendor: RecorderVendor }

function GridCell({
  cam,
  storeId,
  edgeId,
}: {
  cam: Cam | null
  storeId: string
  edgeId: string | null
}) {
  const inner = (
    <div className="relative h-full w-full bg-gradient-to-br from-slate-800 to-slate-950">
      {cam && (
        <>
          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-px text-[10px] text-white">
            ch{String(cam.channel).padStart(2, '0')}
          </span>
          <span className="absolute right-1 top-1 truncate text-[9px] text-white/70">
            {cam.name}
          </span>
        </>
      )}
    </div>
  )

  if (!edgeId || !cam) return inner

  return (
    <Link
      href={`/stores/${storeId}/cam/${cam.id}/live`}
      className="block h-full w-full hover:ring-1 hover:ring-blue-400 active:ring-blue-500"
      title={cam.name}
    >
      {inner}
    </Link>
  )
}

export function MonitorWorkspace({
  storeId,
  storeName,
  area,
  edgeId,
  cameras,
}: {
  storeId: string
  storeName: string
  area: string | null
  edgeId: string | null
  cameras: Cam[]
}) {
  const { t }             = useLang()
  // Grid mode auto-starts when the workspace mounts (store selected) and
  // stops on unmount. Users can also pause/resume via the toolbar button.
  // Skip auto-start when no edge is configured — otherwise the toolbar
  // would lie about being "active" while no commands are reaching anyone.
  const [active, setActive] = useState(!!edgeId)
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  // Timestamp of the last grid JPEG re-fetch — surfaced as a small label
  // so the user can see at a glance whether the auto-refresh timer is
  // still alive. If this stops advancing, the timer died (or paused).
  const [lastRefreshMs, setLastRefreshMs] = useState<number | null>(null)
  const [refreshCount,  setRefreshCount]  = useState(0)
  const [page, setPage]     = useState(0)
  const [err]               = useState<string | null>(null)
  const [vodOpen, setVodOpen] = useState(false)
  const timer               = useRef<NodeJS.Timeout | null>(null)
  // Pending stop_grid timer — see grid effect below. Refs persist across
  // effect re-runs, so a fresh mount can cancel a stop scheduled by the
  // previous cleanup (StrictMode dev bounce).
  const stopTimer           = useRef<NodeJS.Timeout | null>(null)
  // F23: live_sessions row id for the current grid session — created when
  // grid mode starts, closed on cleanup. Without this the audit log (which
  // reads live_sessions) stays empty forever.
  const sessionId           = useRef<string | null>(null)

  // VOD replay supports uniview (RTSP replay) and frigate (HTTP MP4 export).
  // The toolbar button is store-level; the modal lets the user pick which
  // VOD-capable camera to replay and clamps the requested window per vendor.
  const vodCams    = cameras.filter((c) => isVodVendor(c.vendor)) as
    Array<Cam & { vendor: VodVendor }>
  const vodEnabled = !!edgeId && vodCams.length > 0

  // 16 cells, null for empty slots
  const cells: (Cam | null)[] = Array.from({ length: 16 }, (_, i) =>
    cameras.find((c) => c.grid_pos === i) ?? null,
  )

  // Mobile: 4 pages × 4 cameras
  const mobilePage = cells.slice(page * 4, page * 4 + 4)

  async function sendCommand(action: 'start_grid' | 'stop_grid') {
    if (!edgeId) return
    await fetch(`/api/edges/${edgeId}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }).catch(console.error)
  }

  function refreshGridUrl() {
    if (!edgeId) return
    const now = Date.now()
    setImgUrl(`/api/edges/${edgeId}/grid?_=${now}`)
    setLastRefreshMs(now)
    setRefreshCount((c) => c + 1)
  }

  // Auto-resume on edgeId arrival. Survives HMR (which can preserve a stale
  // `active=false` from a prior dev session) and handles the case where a
  // store's edge becomes available after the workspace already mounted.
  // Users can still pause via the toolbar toggle; we only push toward ON.
  useEffect(() => {
    if (edgeId && !active) setActive(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edgeId])

  useEffect(() => {
    if (!active || !edgeId) return
    // F75: Cancel ANY pending stop_* (stop_grid OR stop_stream) for this
    // edge via the shared registry. Covers all of:
    //  (a) StrictMode dev double-mount on the same MonitorWorkspace,
    //  (b) re-mount of /grid for the same store (/stores/A → /map → /stores/A),
    //  (c) cross-mode arrival from /live (live cleanup's stop_stream).
    // Without (c), a fast /live → /grid would race and stop_stream would
    // tear down the grid we just started.
    cancelPendingStop(edgeId)
    // Local stopTimer ref is also cleared for completeness (StrictMode case).
    if (stopTimer.current) {
      clearTimeout(stopTimer.current)
      stopTimer.current = null
    }
    sendCommand('start_grid')
    refreshGridUrl()
    timer.current = setInterval(refreshGridUrl, REFRESH_MS)

    // F23: open a live_sessions row for the audit log
    let cancelled = false
    void fetch('/api/sessions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'start', mode: 'grid', storeId }),
    })
      .then(async (r) => r.ok ? r.json() as Promise<{ id: string }> : null)
      .then((j) => { if (!cancelled && j?.id) sessionId.current = j.id })
      .catch(() => { /* fire-and-forget — audit log is best-effort */ })

    // Capture the edgeId in closure so the cleanup uses the right key
    // even if the prop changes later (defensive — the dep array makes the
    // effect re-run on edgeId change anyway).
    const cleanupEdgeId = edgeId

    return () => {
      cancelled = true
      if (timer.current) clearInterval(timer.current)
      // F75: register the pending stop in the shared registry so any
      // upcoming mount (grid OR live) can cancel it.
      const handle = scheduleStop(
        cleanupEdgeId,
        () => { sendCommand('stop_grid') },
        GRID_STOP_DELAY_MS,
      )
      stopTimer.current = handle
      // F23: close the session row
      const id = sessionId.current
      if (id) {
        sessionId.current = null
        void fetch('/api/sessions', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ action: 'end', id }),
          // Use keepalive so the request survives page unload.
          keepalive: true,
        }).catch(() => { /* ignore */ })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, edgeId])

  return (
    <main className="flex h-full flex-col overflow-hidden bg-slate-100">
      {/* ── Toolbar ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2 md:px-4">
        {/* Breadcrumb */}
        <div className="min-w-0 truncate text-xs text-slate-600">
          <span className="hidden sm:inline">{area ?? t.workspace.unclassified} / </span>
          <b className="text-slate-900">{storeName}</b>
          <span className="text-slate-400"> / {t.workspace.split16}</span>
        </div>

        {/* Action buttons */}
        <div className="flex flex-shrink-0 items-center gap-1">
          {/* Refresh-alive indicator — proves the auto-update timer is firing
              even when the underlying camera scene looks static. Hidden when
              grid mode is off. */}
          {active && lastRefreshMs && (
            <span
              className="hidden font-mono text-[10px] tabular-nums text-slate-500 sm:inline"
              title={`#${refreshCount} @ ${new Date(lastRefreshMs).toLocaleTimeString()}`}
            >
              #{refreshCount}
            </span>
          )}

          <Link
            href="/map"
            className="hidden rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 sm:inline-block"
          >
            {t.workspace.mapLink}
          </Link>

          <button
            disabled={!edgeId}
            onClick={() => setActive((v) => !v)}
            className={
              'rounded px-2.5 py-1 text-xs font-medium sm:px-3 ' +
              (active
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-blue-600 text-white hover:bg-blue-700') +
              ' disabled:cursor-not-allowed disabled:opacity-50'
            }
          >
            {active ? t.workspace.stopMonitor : t.workspace.startMonitor}
          </button>

          <button
            disabled={!vodEnabled}
            onClick={() => setVodOpen(true)}
            title={vodEnabled ? undefined : t.vod.noVod}
            className="hidden rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 sm:inline-block"
          >
            {t.workspace.playbackBtn}
          </button>
        </div>
      </div>

      {vodOpen && (
        <VodRangeModal
          storeId={storeId}
          cameras={vodCams}
          onClose={() => setVodOpen(false)}
        />
      )}

      {/* ── Viewport ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-2 md:p-3.5">

        {/* Desktop: 4×4 grid */}
        <div className="relative hidden aspect-video overflow-hidden rounded bg-slate-950 p-0.5 md:block">
          {imgUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imgUrl} alt={t.workspace.split16} className="h-full w-full object-contain" />
          ) : (
            <div className="grid h-full w-full grid-cols-4 grid-rows-4 gap-px">
              {cells.map((cam, i) => (
                <GridCell key={i} cam={cam} storeId={storeId} edgeId={edgeId} />
              ))}
              <StatusOverlay edgeId={edgeId} active={active} />
            </div>
          )}
          {imgUrl && edgeId && (
            <div className="absolute inset-0.5 grid grid-cols-4 grid-rows-4 gap-px">
              {cells.map((cam, i) => (
                <Link
                  key={i}
                  href={cam ? `/stores/${storeId}/cam/${cam.id}/live` : '#'}
                  className={cam ? 'hover:bg-blue-500/10' : 'pointer-events-none'}
                />
              ))}
            </div>
          )}
        </div>

        {/* Mobile: 2×2 paged grid */}
        <div className="md:hidden">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500">
              {t.workspace.camRange(page * 4 + 1, Math.min(page * 4 + 4, 16))}
            </span>
            <div className="flex gap-1">
              {[0, 1, 2, 3].map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={
                    'h-6 w-6 rounded text-[11px] font-mono ' +
                    (p === page
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-slate-500 border border-slate-200')
                  }
                >
                  {p + 1}
                </button>
              ))}
            </div>
          </div>

          <div className="relative grid grid-cols-2 gap-px overflow-hidden rounded bg-slate-950">
            {imgUrl ? (
              <div className="col-span-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imgUrl} alt={t.workspace.split16} className="w-full object-contain" />
              </div>
            ) : (
              mobilePage.map((cam, i) => (
                <div key={i} className="aspect-video">
                  <GridCell cam={cam} storeId={storeId} edgeId={edgeId} />
                </div>
              ))
            )}
            <StatusOverlay edgeId={edgeId} active={active} />
          </div>

          {!active && edgeId && (
            <p className="mt-2 text-center text-[11px] text-slate-400">
              {t.workspace.pressToStart}
            </p>
          )}
        </div>

        {/* F33: 16分割の下にあった疑似プレイバックパネルを撤去。
            実際の VOD 再生はカメラ単位でツールバーの「⏪ 録画」ボタン
            → モーダル経由で /stores/.../vod に遷移する作りなので、
            ここの非インタラクティブな飾り UI は混乱を招くだけだった。 */}

        {err && <p className="mt-2 text-xs text-red-600">Error: {err}</p>}
      </div>
    </main>
  )
}

function StatusOverlay({
  edgeId,
  active,
}: {
  edgeId: string | null
  active: boolean
}) {
  const { t } = useLang()

  if (!edgeId) {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400">
        {t.workspace.edgeNotRegistered}
      </div>
    )
  }
  if (!active) {
    return (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400">
        {t.workspace.pressToStart}
      </div>
    )
  }
  return null
}

/** Current store-local (JST) wall-clock, minus `offsetMin`, as "YYYY-MM-DDTHH:mm". */
function defaultFromLocal(offsetMin: number): string {
  // Shift the real instant by +09:00, then read its UTC fields → JST wall-clock.
  const ms = Date.now() - offsetMin * 60_000 + 9 * 60 * 60 * 1000
  return new Date(ms).toISOString().slice(0, 16)
}

/**
 * Range-picker modal launched from the toolbar 録画 button. Collects a
 * VOD-capable camera (uniview or frigate) + start wall-clock + duration,
 * converts the wall-clock to a store-tz (JST) instant, and navigates to the
 * per-camera VOD route. The VOD page sends the actual start_vod command
 * (mirrors the live route).
 *
 * The duration cap depends on the selected camera's vendor: uniview replays
 * as a real RTSP stream (60 min cap), frigate materializes the whole range
 * as a clip.mp4 before the first frame (5 min cap to keep latency sane).
 */
function VodRangeModal({
  storeId,
  cameras,
  onClose,
}: {
  storeId: string
  cameras: Array<Cam & { vendor: VodVendor }>
  onClose: () => void
}) {
  const { t }      = useLang()
  const router     = useRouter()
  const [camId, setCamId]   = useState(cameras[0]?.id ?? '')
  const [from, setFrom]     = useState(() => defaultFromLocal(VOD_RANGE_DEFAULT_MIN))
  const [range, setRange]   = useState(VOD_RANGE_DEFAULT_MIN)

  // Cap follows the currently-selected camera's vendor. When the user switches
  // from a uniview camera to a frigate one mid-modal, clamp `range` down.
  const selectedCam = cameras.find((c) => c.id === camId) ?? cameras[0]
  const rangeMax = selectedCam ? VOD_RANGE_MAX_MIN_BY_VENDOR[selectedCam.vendor] : 60
  useEffect(() => {
    if (range > rangeMax) setRange(rangeMax)
  }, [rangeMax, range])

  function play() {
    if (!camId || !from) return
    // Interpret the entered wall-clock as store-local (JST). Emit UTC ISO
    // instants — the VOD page/edge only care about the absolute instant.
    const fromMs = new Date(`${from}:00${STORE_TZ_OFFSET}`).getTime()
    if (Number.isNaN(fromMs)) return
    const clamped = Math.max(1, Math.min(rangeMax, range))
    const fromIso = new Date(fromMs).toISOString()
    const toIso   = new Date(fromMs + clamped * 60_000).toISOString()
    router.push(
      `/stores/${storeId}/cam/${camId}/vod` +
        `?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t.vod.modalTitle}</h2>

        <label className="mb-1 block text-xs font-medium text-slate-600">{t.vod.cameraLabel}</label>
        <select
          value={camId}
          onChange={(e) => setCamId(e.target.value)}
          className="mb-3 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        >
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              ch{String(c.channel).padStart(2, '0')} {c.name} [{c.vendor}]
            </option>
          ))}
        </select>

        <label className="mb-1 block text-xs font-medium text-slate-600">{t.vod.fromLabel}</label>
        <input
          type="datetime-local"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="mb-3 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        />

        <label className="mb-1 flex items-baseline justify-between text-xs font-medium text-slate-600">
          <span>{t.vod.rangeLabel}（{t.vod.minutesUnit}）</span>
          <span className="text-[10px] text-slate-400">
            {t.vod.maxLabel} {rangeMax} {t.vod.minutesUnit}
          </span>
        </label>
        <input
          type="number"
          min={1}
          max={rangeMax}
          value={range}
          onChange={(e) =>
            setRange(Math.max(1, Math.min(rangeMax, Number(e.target.value) || 1)))
          }
          className="mb-4 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
          >
            {t.vod.cancel}
          </button>
          <button
            onClick={play}
            disabled={!camId || !from}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t.vod.confirm}
          </button>
        </div>
      </div>
    </div>
  )
}
