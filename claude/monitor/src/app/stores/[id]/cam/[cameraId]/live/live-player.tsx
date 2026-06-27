'use client'

/**
 * Single-camera live view — dual-mode player.
 *
 * Modes
 * ─────
 * **iframe (smooth)**  — Frigate's built-in MSE/WebRTC live UI, embedded in
 *   an <iframe>. ~1-2 s latency, 25 fps. Requires the browser to reach the
 *   recorder over the LAN, so it only works when `liveIframeUrl` is set
 *   (see `recorders.live_host`) and is fragile under network congestion
 *   because it streams continuous video.
 *
 * **jpeg (lightweight)** — the original F13 flow: edge-agent uploads
 *   per-camera snapshot.jpg to Supabase Storage every ~1 s, browser polls.
 *   ~2-3 s latency, 1 fps, but ROBUST under congestion (small payloads,
 *   drops frames gracefully). This is the BCP-friendly mode the user
 *   explicitly asked us to keep available.
 *
 * Selection
 * ─────────
 *  - Default: iframe if liveIframeUrl present, else jpeg.
 *  - User toggle in the toolbar persists to localStorage per camera.
 *  - iframe onerror → auto-fall back to jpeg with a banner.
 *
 * F74/F75 stop_stream race handling stays only in jpeg mode (edge-agent
 * commands are irrelevant when the browser streams direct from the NVR).
 */

import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { cancelPendingStop, scheduleStop } from '@/lib/edge-stop-registry'
import { SaveJpegButton } from '@/components/SaveJpegButton'

// Floor between snapshot frames. Polling is onLoad-driven (the next fetch
// starts only after the current frame settles), so this is just a small gap
// to avoid hammering — NOT a fixed interval. A fixed 1s interval cancelled
// every in-flight request because the snapshot route round-trips to Supabase
// (getUser + Storage) and routinely takes >1s.
const FRAME_GAP_MS = 400
const ERROR_THRESHOLD = 5
const STOP_DELAY_MS = 300

// MJPEG/スナップの帯域自動劣化（回線細時に軽量化）。フレーム取得が遅いほど
// 取得間隔を段階的に広げ(=fps低下=帯域減)、回復したら戻す。level=0 が通常。
const ADAPTIVE_GAPS_MS = [FRAME_GAP_MS, 1000, 2500, 5000]
const SLOW_FRAME_MS = 1200   // 1フレーム取得がこれ超で「回線細」と判定→劣化
const FAST_FRAME_MS = 600    // これ未満が続けば回復→1段戻す

// 'hq' = go2rtc 高画質(H.265→H.264 変換ライブ・Cloudflare Tunnel経由 stream.html iframe)
type Mode = 'hq' | 'iframe' | 'jpeg'

// F80.1: key bumped to v2. The v1 auto-fallback persisted 'jpeg' on a
// transient iframe timeout (see onError below), which permanently stuck
// cameras on the lightweight mode even after Frigate recovered. Bumping the
// key discards all polluted v1 prefs so every camera re-defaults to iframe
// (high-quality) when supported. Only explicit user button clicks persist now.
function modePrefKey(cameraId: string): string {
  return `intereco:live-mode-v2:${cameraId}`
}

function loadMode(cameraId: string, defaultMode: Mode): Mode {
  if (typeof window === 'undefined') return defaultMode
  try {
    const v = window.localStorage.getItem(modePrefKey(cameraId))
    return v === 'hq' || v === 'iframe' || v === 'jpeg' ? v : defaultMode
  } catch {
    return defaultMode
  }
}

function saveMode(cameraId: string, mode: Mode): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(modePrefKey(cameraId), mode) } catch { /* noop */ }
}

interface Props {
  edgeId:        string
  cameraId:      string
  storeId:       string
  room:          string  // unused; kept for caller compatibility
  liveIframeUrl: string | null
  // True when liveIframeUrl is an MJPEG stream (remote/tunnel case) rather than
  // Frigate's embeddable WebRTC UI. MJPEG must render in an <img>, not an
  // <iframe> (a multipart/x-mixed-replace response never fires the iframe load
  // event, which would trip the 8s fallback watchdog).
  liveIsImageStream?: boolean
  // go2rtc high-quality URL (stream.html, via Cloudflare Tunnel). When set, the
  // camera gets a 高画質(go2rtc) mode that embeds go2rtc's own player. This is
  // how onvif-generic / i-PRO H.265 cameras get high-quality live (edge go2rtc
  // transcodes H.265→H.264). Independent of liveIframeUrl (Frigate).
  hqUrl?: string | null
}

// 利用可能なモードから、保存済み設定を尊重しつつ有効なモードを選ぶ。
function resolveMode(prefer: Mode, hasHq: boolean, hasIframe: boolean): Mode {
  if (prefer === 'hq' && hasHq) return 'hq'
  if (prefer === 'iframe' && hasIframe) return 'iframe'
  if (prefer === 'jpeg') return 'jpeg'
  // 設定が今のカメラで使えない → 高画質を優先(go2rtc > Frigate)、無ければ軽量。
  return hasHq ? 'hq' : hasIframe ? 'iframe' : 'jpeg'
}

export default function LivePlayer({ edgeId, cameraId, storeId, liveIframeUrl, liveIsImageStream, hqUrl }: Props) {
  // Default mode: go2rtc高画質 > Frigate iframe > jpeg. User pref overrides.
  const defaultMode: Mode = hqUrl ? 'hq' : liveIframeUrl ? 'iframe' : 'jpeg'
  const [mode, setMode]   = useState<Mode>(defaultMode)
  // Auto-fallback banner when iframe fails to load.
  const [iframeFailed, setIframeFailed] = useState(false)

  // Hydrate pref from localStorage on mount (avoids SSR mismatch).
  useEffect(() => {
    const prefer = loadMode(cameraId, defaultMode)
    setMode(resolveMode(prefer, !!hqUrl, !!liveIframeUrl))
  }, [cameraId, defaultMode, liveIframeUrl, hqUrl])

  // ライブ視聴セッション(audit + 同時上限 F-10)を全モード共通で1本管理する。
  // モード切替(hq/iframe/jpeg)を跨いで1セッション。429=上限到達で視聴をブロック。
  const sessionId = useRef<string | null>(null)
  const [limitReached, setLimitReached] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/sessions', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ action: 'start', mode: 'live', storeId, cameraId }),
        })
        if (cancelled) return
        if (res.status === 429) { setLimitReached(true); return }
        if (res.ok) {
          const j = await res.json().catch(() => null) as { id?: string } | null
          if (!cancelled && j?.id) sessionId.current = j.id
        }
      } catch { /* 上限チェックの一時失敗では視聴を止めない(可用性優先) */ }
    })()
    return () => {
      cancelled = true
      const sid = sessionId.current
      if (sid) {
        sessionId.current = null
        void fetch('/api/sessions', {
          method:    'POST',
          headers:   { 'Content-Type': 'application/json' },
          body:      JSON.stringify({ action: 'end', id: sid }),
          keepalive: true,
        }).catch(() => {})
      }
    }
  }, [storeId, cameraId])

  function switchMode(next: Mode): void {
    setIframeFailed(false)
    setMode(next)
    saveMode(cameraId, next)
  }

  return (
    <div className="relative flex h-[calc(100vh-44px)] flex-col bg-black">
      <ModeToolbar
        mode={mode}
        hqSupported={!!hqUrl}
        iframeSupported={!!liveIframeUrl}
        iframeFailed={iframeFailed}
        onSwitch={switchMode}
      />
      <div className="relative flex-1">
        {limitReached ? (
          <LiveLimitOverlay />
        ) : mode === 'hq' && hqUrl ? (
          <Go2rtcMode url={hqUrl} storeId={storeId} cameraId={cameraId} />
        ) : mode === 'iframe' && liveIframeUrl ? (
          liveIsImageStream ? (
            // Remote MJPEG stream (via Cloudflare Tunnel). Render in <img> with
            // an Access-aware error overlay instead of auto-falling back to
            // jpeg: a failed load is usually "not yet authenticated to the
            // camera domain", so we offer a one-click login + retry.
            <ImageStreamMode url={liveIframeUrl} />
          ) : (
            <IframeMode
              url={liveIframeUrl}
              onError={() => {
                // F80.1: auto-fallback is SESSION-ONLY. Do NOT persist 'jpeg'
                // here — a transient timeout (slow LAN, Frigate restart) must
                // not permanently downgrade the camera. The user's explicit
                // choice (switchMode → saveMode) is the only thing that sticks.
                setIframeFailed(true)
                setMode('jpeg')
              }}
            />
          )
        ) : (
          <JpegMode edgeId={edgeId} cameraId={cameraId} />
        )}
      </div>
    </div>
  )
}

// 同時視聴上限(F-10)に達した時のオーバーレイ。
function LiveLimitOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4">
      <div className="max-w-md rounded-lg bg-amber-950/90 px-5 py-4 text-center text-sm text-amber-100 ring-1 ring-amber-700">
        <div className="text-base font-semibold">同時視聴の上限に達しました</div>
        <p className="mt-2 text-xs text-amber-200">
          現在、契約の同時ライブ/再生の上限まで視聴中です。
          他の端末・タブの視聴を終了してから、もう一度開いてください。
        </p>
        <button
          onClick={() => history.back()}
          className="mt-3 rounded bg-amber-700 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-600"
        >
          監視に戻る
        </button>
      </div>
    </div>
  )
}

// ─── Mode toolbar ───────────────────────────────────────────────────────────

function ModeToolbar({
  mode, hqSupported, iframeSupported, iframeFailed, onSwitch,
}: {
  mode:            Mode
  hqSupported:     boolean
  iframeSupported: boolean
  iframeFailed:    boolean
  onSwitch:        (m: Mode) => void
}) {
  const label =
    mode === 'hq'     ? '高画質ライブ (go2rtc H.264変換)'
    : mode === 'iframe' ? '高画質ライブ (NVR直接)'
    : '軽量モード (1秒スナップ)'
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5 text-[11px]">
      <div className="flex items-center gap-1.5">
        {hqSupported && (
          <button
            type="button"
            onClick={() => onSwitch('hq')}
            className={
              'rounded px-2 py-0.5 ' +
              (mode === 'hq'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-200 hover:bg-slate-600')
            }
            title="高画質 (go2rtcでH.265→H.264変換, ~1-3s 遅延)"
          >
            🎬 高画質
          </button>
        )}
        {iframeSupported && (
          <button
            type="button"
            onClick={() => onSwitch('iframe')}
            className={
              'rounded px-2 py-0.5 ' +
              (mode === 'iframe'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700 text-slate-200 hover:bg-slate-600')
            }
            title="高画質 (Frigate, 25fps, ~1-2s 遅延)"
          >
            🎥 高画質{hqSupported ? '(Frigate)' : ''}
          </button>
        )}
        <button
          type="button"
          onClick={() => onSwitch('jpeg')}
          className={
            'rounded px-2 py-0.5 ' +
            (mode === 'jpeg'
              ? 'bg-blue-600 text-white'
              : 'bg-slate-700 text-slate-200 hover:bg-slate-600')
          }
          title="軽量モード — BCP / 回線混雑時推奨 (1fps, 低帯域)"
        >
          📡 軽量 (BCP用)
        </button>
      </div>
      <div className="text-[10px] text-slate-400">
        {label}
        {iframeFailed && (
          <span className="ml-2 text-amber-400">⚠ 高画質モード接続失敗 — 軽量モードへ自動切替</span>
        )}
      </div>
    </div>
  )
}

// ─── iframe mode ────────────────────────────────────────────────────────────

function IframeMode({ url, onError }: { url: string; onError: () => void }) {
  // iframe's onError doesn't fire on most browsers for cross-origin embeds,
  // so we use a timeout + content-load probe. After 8 s of no load event we
  // assume the embed is dead and fall back. This is rough; we improve it in
  // F80.1 if needed.
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => {
      if (!loaded) onError()
    }, 8_000)
    return () => clearTimeout(t)
  }, [loaded, onError])

  return (
    <iframe
      src={url}
      className="h-full w-full border-0"
      allow="autoplay; fullscreen"
      // sandbox kept open enough for Frigate's React UI to run scripts
      // and websockets, but no top navigation or popup spawn.
      sandbox="allow-scripts allow-same-origin allow-forms"
      onLoad={() => setLoaded(true)}
      onError={onError}
      title="NVR live"
    />
  )
}

// ─── go2rtc high-quality mode (H.265→H.264, via monitor's authenticated proxy) ─

function Go2rtcMode({ url, storeId, cameraId }: { url: string; storeId?: string; cameraId?: string }) {
  // `url` is the monitor's OWN proxy HLS playlist (/api/live-proxy/<cam>/...),
  // not go2rtc directly. The proxy attaches the Cloudflare Access service token
  // server-side, so playback needs only the monitor (Supabase) session — no
  // second Cloudflare login. Same-origin, so hls.js (no CORS issue) works.
  const videoRef                  = useRef<HTMLVideoElement>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [failed, setFailed]       = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    setFailed(false)

    // C3 計測: 初フレーム表示までの時間(ttff_ms)を1回だけ ingest（best-effort）。
    const startTs = Date.now()
    let reported = false
    const onPlaying = () => {
      if (reported) return
      reported = true
      const ttff = Date.now() - startTs
      void fetch('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'ttff_ms', storeId, cameraId, value: ttff }),
        keepalive: true,
      }).catch(() => {})
    }
    video.addEventListener('playing', onPlaying)

    // Safari plays HLS natively; everyone else uses hls.js.
    if (!Hls.isSupported()) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url
        video.play().catch(() => {})
        return () => video.removeEventListener('playing', onPlaying)
      }
      setFailed(true)
      return () => video.removeEventListener('playing', onPlaying)
    }

    const hls = new Hls({ liveSyncDurationCount: 3, manifestLoadingMaxRetry: 2 })
    hls.loadSource(url)
    hls.attachMedia(video)
    hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}) })
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      // Fatal errors (network/media) → show retry. Non-fatal are auto-recovered.
      if (data.fatal) setFailed(true)
    })
    return () => { video.removeEventListener('playing', onPlaying); hls.destroy() }
  }, [url, reloadKey, storeId, cameraId])

  return (
    <div className="relative h-full w-full bg-black">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        controls
        className="h-full w-full bg-black object-contain"
      />
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 px-6 text-center text-sm text-slate-200">
          <div>高画質映像を表示できません（go2rtc / 回線）。</div>
          <button
            type="button"
            onClick={() => { setFailed(false); setReloadKey((k) => k + 1) }}
            className="rounded bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600"
          >
            🔄 再試行
          </button>
        </div>
      )}
    </div>
  )
}

// ─── remote MJPEG image stream (Cloudflare Tunnel) ───────────────────────────

function ImageStreamMode({ url }: { url: string }) {
  // Remote high-quality is a Frigate MJPEG stream behind Cloudflare Access.
  // When the operator hasn't yet authenticated to the camera domain, the
  // <img> request is 302'd to the Access login and the load fails. Rather than
  // silently dropping to jpeg, surface a one-click "log in to the camera"
  // action: the operator authenticates once (SameSite=None CF_Authorization
  // cookie), then Retry re-requests the stream — now the cookie is present.
  const [errored, setErrored] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  let loginOrigin: string | null = null
  try { loginOrigin = new URL(url).origin } catch { loginOrigin = null }
  const src = `${url}${url.includes('?') ? '&' : '?'}_r=${reloadKey}`

  return (
    <div className="relative h-full w-full bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={reloadKey}
        src={src}
        className="h-full w-full bg-black object-contain"
        onLoad={() => setErrored(false)}
        onError={() => setErrored(true)}
        alt="NVR live"
      />
      {errored && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 px-6 text-center text-sm text-slate-200">
          <div>
            高画質映像を表示できません。
            <br />
            カメラ側の認証が必要な場合があります。
          </div>
          <div className="flex gap-2">
            {loginOrigin && (
              <button
                type="button"
                onClick={() => window.open(loginOrigin!, '_blank', 'noopener,noreferrer')}
                className="rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
              >
                📹 カメラにログイン
              </button>
            )}
            <button
              type="button"
              onClick={() => { setErrored(false); setReloadKey((k) => k + 1) }}
              className="rounded bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600"
            >
              🔄 再試行
            </button>
          </div>
          <div className="text-[11px] text-slate-400">
            別タブでログイン後、「再試行」を押してください
          </div>
        </div>
      )}
    </div>
  )
}

// ─── JPEG mode (legacy F13 + F74/F75 flow) ──────────────────────────────────

function JpegMode({
  edgeId, cameraId,
}: {
  edgeId:   string
  cameraId: string
}) {
  // セッション(audit + 同時上限)は LivePlayer 直下で全モード共通に管理する。
  // ここは描画と edge への start_live/stop_stream コマンドのみ。
  const [tick, setTick]         = useState(0)
  const [loaded, setLoaded]     = useState(0)
  const [failStreak, setFails]  = useState(0)
  const cancelledRef            = useRef(false)
  const pollTimer               = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frameStartRef           = useRef(0)        // 現フレームの取得開始時刻
  const levelRef                = useRef(0)        // 帯域劣化レベル(0=通常)
  const [degraded, setDegraded] = useState(0)      // 表示用ミラー

  // Advance to the next frame after the current <img> settles (load or error).
  // onLoad-driven instead of a fixed interval so a slow snapshot route never
  // gets its request cancelled by the next tick. 取得間隔は劣化レベルで可変。
  function scheduleNextFrame() {
    if (cancelledRef.current) return
    if (pollTimer.current) clearTimeout(pollTimer.current)
    const gap = ADAPTIVE_GAPS_MS[levelRef.current] ?? FRAME_GAP_MS
    pollTimer.current = setTimeout(() => {
      if (cancelledRef.current) return
      frameStartRef.current = Date.now()
      setTick((t) => t + 1)
    }, gap)
  }

  // フレーム取得完了。所要時間で帯域劣化レベルを上げ下げする。
  function onFrameLoad() {
    setLoaded((n) => n + 1)
    setFails(0)
    const dt = frameStartRef.current ? Date.now() - frameStartRef.current : 0
    if (dt > SLOW_FRAME_MS && levelRef.current < ADAPTIVE_GAPS_MS.length - 1) {
      levelRef.current += 1; setDegraded(levelRef.current)
    } else if (dt > 0 && dt < FAST_FRAME_MS && levelRef.current > 0) {
      levelRef.current -= 1; setDegraded(levelRef.current)
    }
    scheduleNextFrame()
  }

  useEffect(() => {
    cancelledRef.current = false
    levelRef.current = 0
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDegraded(0)   // カメラ切替時に劣化表示をリセット
    cancelPendingStop(edgeId)
    fetch(`/api/edges/${edgeId}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start_live', camera_id: cameraId }),
    }).catch(() => {})

    // Kick off the first fetch; subsequent frames are driven by the <img>
    // onLoad/onError handlers via scheduleNextFrame().
    frameStartRef.current = Date.now()
    setTick((t) => t + 1)

    const cleanupEdgeId = edgeId

    return () => {
      cancelledRef.current = true
      if (pollTimer.current) { clearTimeout(pollTimer.current); pollTimer.current = null }
      scheduleStop(cleanupEdgeId, () => {
        fetch(`/api/edges/${cleanupEdgeId}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop_stream' }),
        }).catch(() => {})
      }, STOP_DELAY_MS)
    }
  }, [edgeId, cameraId])

  const showError   = failStreak >= ERROR_THRESHOLD && loaded === 0
  const showWaiting = loaded === 0 && !showError

  return (
    <div className="relative h-full w-full bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/edges/${edgeId}/cam/${cameraId}/snapshot?_=${tick}`}
        alt="live"
        className="h-full w-full object-contain"
        onLoad={onFrameLoad}
        onError={() => { setFails((n) => n + 1); scheduleNextFrame() }}
      />

      {loaded > 0 && (
        <div className="absolute right-2 top-2">
          <SaveJpegButton endpoint={`/api/edges/${edgeId}/cam/${cameraId}/snapshot`} name={`live_${cameraId.slice(0, 8)}`} />
        </div>
      )}

      {showWaiting && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-300">
          <div className="rounded bg-black/60 px-4 py-2">読込中…</div>
        </div>
      )}
      {showError && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="max-w-md rounded bg-red-950/90 px-5 py-4 text-sm text-red-100 ring-1 ring-red-700">
            <div className="font-semibold">読込失敗 ({failStreak})</div>
            <div className="mt-1 text-xs text-red-200">
              エッジ <code>{edgeId.slice(0, 8)}…</code> がこのカメラの JPEG を Storage にまだ
              アップロードしていません。原因の多くは以下:
            </div>
            <ol className="ml-4 mt-1.5 list-decimal text-xs text-red-200">
              <li>edge-agent が起動していない</li>
              <li>start_live コマンドが届いていない</li>
              <li>RTSP / Frigate からフレームが取れていない</li>
            </ol>
            <button
              onClick={() => { setFails(0); setTick((t) => t + 1) }}
              className="mt-3 rounded bg-red-700 px-3 py-1 text-xs font-semibold text-white hover:bg-red-600"
            >
              再試行
            </button>
          </div>
        </div>
      )}

      {loaded > 0 && (
        <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 font-mono text-[10px] tabular-nums text-slate-300">
          #{loaded}
        </div>
      )}

      {degraded > 0 && (
        <div className="absolute bottom-2 right-2 rounded bg-amber-900/80 px-2 py-0.5 text-[10px] font-medium text-amber-100 ring-1 ring-amber-700/60"
             title="回線が細いため自動で軽量化しています（フレーム間隔を拡大）">
          ⚠ 回線細→軽量化中 (約 {(1000 / (ADAPTIVE_GAPS_MS[degraded] ?? FRAME_GAP_MS)).toFixed(1)} fps)
        </div>
      )}
    </div>
  )
}
