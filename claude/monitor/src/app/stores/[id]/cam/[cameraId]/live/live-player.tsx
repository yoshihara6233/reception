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
import { cancelPendingStop, scheduleStop } from '@/lib/edge-stop-registry'

const POLL_MS = 1_000
const ERROR_THRESHOLD = 5
const STOP_DELAY_MS = 300

type Mode = 'iframe' | 'jpeg'

function modePrefKey(cameraId: string): string {
  return `intereco:live-mode:${cameraId}`
}

function loadMode(cameraId: string, defaultMode: Mode): Mode {
  if (typeof window === 'undefined') return defaultMode
  try {
    const v = window.localStorage.getItem(modePrefKey(cameraId))
    return v === 'iframe' || v === 'jpeg' ? v : defaultMode
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
}

export default function LivePlayer({ edgeId, cameraId, storeId, liveIframeUrl }: Props) {
  // Default mode: iframe when supported, jpeg otherwise. User pref overrides.
  const defaultMode: Mode = liveIframeUrl ? 'iframe' : 'jpeg'
  const [mode, setMode]   = useState<Mode>(defaultMode)
  // Auto-fallback banner when iframe fails to load.
  const [iframeFailed, setIframeFailed] = useState(false)

  // Hydrate pref from localStorage on mount (avoids SSR mismatch).
  useEffect(() => {
    const prefer = loadMode(cameraId, defaultMode)
    // If user prefers iframe but the camera doesn't support it, fall back.
    setMode(prefer === 'iframe' && !liveIframeUrl ? 'jpeg' : prefer)
  }, [cameraId, defaultMode, liveIframeUrl])

  function switchMode(next: Mode): void {
    setIframeFailed(false)
    setMode(next)
    saveMode(cameraId, next)
  }

  return (
    <div className="relative flex h-[calc(100vh-44px)] flex-col bg-black">
      <ModeToolbar
        mode={mode}
        iframeSupported={!!liveIframeUrl}
        iframeFailed={iframeFailed}
        onSwitch={switchMode}
      />
      <div className="relative flex-1">
        {mode === 'iframe' && liveIframeUrl ? (
          <IframeMode
            url={liveIframeUrl}
            onError={() => {
              setIframeFailed(true)
              setMode('jpeg')
              saveMode(cameraId, 'jpeg')
            }}
          />
        ) : (
          <JpegMode edgeId={edgeId} cameraId={cameraId} storeId={storeId} />
        )}
      </div>
    </div>
  )
}

// ─── Mode toolbar ───────────────────────────────────────────────────────────

function ModeToolbar({
  mode, iframeSupported, iframeFailed, onSwitch,
}: {
  mode:            Mode
  iframeSupported: boolean
  iframeFailed:    boolean
  onSwitch:        (m: Mode) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5 text-[11px]">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={!iframeSupported}
          onClick={() => onSwitch('iframe')}
          className={
            'rounded px-2 py-0.5 ' +
            (mode === 'iframe'
              ? 'bg-blue-600 text-white'
              : iframeSupported
                ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                : 'cursor-not-allowed bg-slate-800 text-slate-500')
          }
          title={iframeSupported ? '高画質 (25fps, ~1-2s 遅延)' : 'このレコーダではiframeモード非対応'}
        >
          🎥 高画質
        </button>
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
        {mode === 'iframe' ? '高画質ライブ (NVR直接)' : '軽量モード (1秒スナップ)'}
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

// ─── JPEG mode (legacy F13 + F74/F75 flow) ──────────────────────────────────

function JpegMode({
  edgeId, cameraId, storeId,
}: {
  edgeId:   string
  cameraId: string
  storeId:  string
}) {
  const [tick, setTick]         = useState(0)
  const [loaded, setLoaded]     = useState(0)
  const [failStreak, setFails]  = useState(0)
  const sessionId               = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    cancelPendingStop(edgeId)
    fetch(`/api/edges/${edgeId}/commands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start_live', camera_id: cameraId }),
    }).catch(() => {})

    void fetch('/api/sessions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'start', mode: 'live', storeId, cameraId }),
    })
      .then(async (r) => r.ok ? r.json() as Promise<{ id: string }> : null)
      .then((j) => { if (!cancelled && j?.id) sessionId.current = j.id })
      .catch(() => {})

    const id = setInterval(() => {
      if (cancelled) return
      setTick((t) => t + 1)
    }, POLL_MS)

    const cleanupEdgeId = edgeId

    return () => {
      cancelled = true
      clearInterval(id)
      scheduleStop(cleanupEdgeId, () => {
        fetch(`/api/edges/${cleanupEdgeId}/commands`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'stop_stream' }),
        }).catch(() => {})
      }, STOP_DELAY_MS)
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
  }, [edgeId, cameraId, storeId])

  const showError   = failStreak >= ERROR_THRESHOLD && loaded === 0
  const showWaiting = loaded === 0 && !showError

  return (
    <div className="relative h-full w-full bg-black">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/edges/${edgeId}/cam/${cameraId}/snapshot?_=${tick}`}
        alt="live"
        className="h-full w-full object-contain"
        onLoad={() => { setLoaded((n) => n + 1); setFails(0) }}
        onError={() => { setFails((n) => n + 1) }}
      />

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
    </div>
  )
}
