'use client'

/**
 * F77 / Phase 8.4-B — VOD player (HTML5 native).
 *
 * Replaces the legacy LiveKit/WHIP player. The flow is:
 *   1. mount → POST /api/vod  {camera_id, from_iso, to_iso} → clip_id
 *   2. poll  → GET  /api/vod/<clip_id>/status   every ~1s
 *      states: queued → uploading → ready  (or failed)
 *   3. ready → render <video src="/api/vod/<clip_id>" controls />
 *      The proxy 302-redirects to a 10-minute signed URL.
 *
 * What we DON'T do anymore
 *   - LiveKitRoom / WHIP ingress / publisher token minting
 *   - Custom scrubber that re-issues start_vod on seek
 *   - ffmpeg pacing-aware first-frame timeout
 *
 * The browser's native <video controls> handles seek/scrub by issuing HTTP
 * Range requests on the signed URL. Frigate's clip.mp4 is a moov-at-front
 * fragmented MP4, so seeking is supported out of the box.
 *
 * Errors
 *   - vendor_unsupported (only Frigate in Phase 8.4-B)
 *   - empty_clip         (no recording in the requested window)
 *   - timeout            (status stays queued/uploading past UPLOAD_TIMEOUT_MS)
 *   - failed             (edge surfaced an error)
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSessionCountdown } from '@/lib/useSessionCountdown'
import { RemainingBadge, SessionCapOverlay } from '@/components/SessionCap'

const POLL_INTERVAL_MS  = 1_000
const UPLOAD_TIMEOUT_MS = 90_000   // Frigate can take 30-60s to assemble a 5-min clip

type ClipStatus = 'queued' | 'uploading' | 'ready' | 'failed'

interface StatusResp {
  clip_id:      string
  status:       ClipStatus
  error?:       string | null
  duration_sec?: number | null
  actual_from?: string | null
  actual_to?:   string | null
  bytes?:       number | null
  ready_at?:    string | null
}

interface CreateResp {
  clip_id?: string
  status?:  ClipStatus
  error?:   string
  message?: string
  // F81: true when the API returned an existing clip instead of creating one.
  reused?:  boolean
}

interface Props {
  edgeId:      string   // kept for parity / audit-log session
  cameraId:    string
  storeId:     string
  room:        string   // unused; kept to avoid touching page.tsx contract
  fromIso:     string
  toIso:       string
  channel:     number
  name:        string
  incidentIso: string | null
}

function fmtJst(iso: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'Asia/Tokyo',
  }).format(new Date(iso))
}

export default function VodPlayer({
  storeId,
  cameraId,
  fromIso,
  toIso,
  channel,
  name,
  incidentIso,
}: Props) {
  const [clipId, setClipId] = useState<string | null>(null)
  const [status, setStatus] = useState<ClipStatus | 'creating' | 'timeout'>('creating')
  const [error,  setError]  = useState<string | null>(null)
  const [bytes,  setBytes]  = useState<number | null>(null)
  // F81: surface reuse so the user sees "再利用" instead of "アップロード中" on cache hit.
  const [reused, setReused] = useState(false)
  const sessionIdRef = useRef<string | null>(null)
  // R1: 視聴セッション時間上限（デフォルト120分・テナント毎）。
  const [maxSessionMin, setMaxSessionMin] = useState<number | null>(null)
  const [startedAtMs, setStartedAtMs]     = useState<number | null>(null)

  function endSession() {
    const sid = sessionIdRef.current
    if (!sid) return
    sessionIdRef.current = null
    void fetch('/api/sessions', {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      JSON.stringify({ action: 'end', id: sid }),
      keepalive: true,
    }).catch(() => {})
  }

  // 1. Create clip + start audit session on mount.
  useEffect(() => {
    let cancelled = false
    const ac = new AbortController()

    ;(async () => {
      try {
        // 同時視聴上限(F-10)を、重い VOD 生成より前に確認。429=上限到達でブロック。
        // 一時失敗(ネットワーク等)では上限チェックを諦めて再生を続行(可用性優先)。
        try {
          const sres = await fetch('/api/sessions', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              action: 'start', mode: 'vod', storeId, cameraId,
              vodFrom: fromIso, vodTo: toIso,
            }),
            signal:  ac.signal,
          })
          if (cancelled) return
          if (sres.status === 429) {
            setStatus('failed')
            setError('同時視聴の上限に達しました。他の視聴を終了してからお試しください。')
            return
          }
          if (sres.ok) {
            const sj = await sres.json().catch(() => null) as { id?: string; maxSessionMin?: number | null } | null
            if (!cancelled && sj?.id) {
              sessionIdRef.current = sj.id
              setMaxSessionMin(sj.maxSessionMin ?? null)
              setStartedAtMs(Date.now())
            }
          }
        } catch { /* 上限チェック一時失敗は無視して続行 */ }
        if (cancelled) return

        const r = await fetch('/api/vod', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ camera_id: cameraId, from_iso: fromIso, to_iso: toIso }),
          signal:  ac.signal,
        })
        const j = (await r.json().catch(() => ({}))) as CreateResp
        if (cancelled) return

        if (!r.ok || !j.clip_id) {
          setStatus('failed')
          setError(j.message ?? j.error ?? `create failed: HTTP ${r.status}`)
          return
        }
        setClipId(j.clip_id)
        setStatus(j.status ?? 'queued')
        if (j.reused) setReused(true)
      } catch (e) {
        if (!cancelled) {
          setStatus('failed')
          setError((e as Error).message ?? String(e))
        }
      }
    })()

    return () => {
      cancelled = true
      ac.abort()
      // Close the audit session even if the upload is still in flight on the
      // edge — the user is leaving the page. The edge finishes the upload
      // regardless (it doesn't need a stop_stream for VOD; the upload runs
      // to completion or to its own AbortController).
      endSession()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraId, storeId, fromIso, toIso])

  // R1: 視聴セッション時間上限のカウントダウン。到達でセッション終了＋再生停止。
  const { remainingSec, expired } = useSessionCountdown(startedAtMs, maxSessionMin)
  useEffect(() => {
    if (expired) endSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired])

  // 2. Poll status until ready/failed/timeout.
  useEffect(() => {
    if (!clipId) return
    if (status === 'ready' || status === 'failed' || status === 'timeout') return

    const startedAt = Date.now()
    let cancelled = false

    const tick = async () => {
      if (cancelled) return
      try {
        const r = await fetch(`/api/vod/${clipId}/status`, { cache: 'no-store' })
        const j = (await r.json().catch(() => ({}))) as StatusResp
        if (cancelled) return

        if (j.status === 'ready') {
          setStatus('ready')
          setBytes(j.bytes ?? null)
          return
        }
        if (j.status === 'failed') {
          setStatus('failed')
          setError(j.error ?? 'upload failed')
          return
        }
        // queued | uploading — keep polling
        setStatus(j.status ?? 'queued')

        if (Date.now() - startedAt > UPLOAD_TIMEOUT_MS) {
          setStatus('timeout')
          setError(`upload exceeded ${UPLOAD_TIMEOUT_MS / 1000}s`)
          return
        }
      } catch {
        // single transient failure — keep polling
      }
      if (!cancelled) setTimeout(tick, POLL_INTERVAL_MS)
    }

    void tick()
    return () => { cancelled = true }
  }, [clipId, status])

  const headerLabel = `ch${String(channel).padStart(2, '0')} ${name}`
  const rangeLabel  = `${fmtJst(fromIso)} 〜 ${fmtJst(toIso)}`

  return (
    <div className="flex h-full flex-col bg-black">
      {/* Top metadata strip — kept simple; the native <video> chrome handles the rest */}
      <div className="flex items-center justify-between bg-slate-900 px-4 py-2 text-[11px] text-slate-300">
        <div>
          <div className="font-semibold text-slate-100">{headerLabel}</div>
          <div className="text-slate-400">{rangeLabel}</div>
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <RemainingBadge remainingSec={expired ? null : remainingSec} />
          {/* F81: reuse badge — surfaced when /api/vod returned an existing clip
              instead of triggering a fresh Frigate generation + upload. */}
          {reused && (
            <span
              className="inline-flex items-center gap-1 rounded bg-emerald-900/60 px-1.5 py-0.5 text-[10px] text-emerald-300"
              title="同じ範囲のクリップが既にあるため再利用しました (Frigate 負荷ゼロ)"
            >
              ♻️ 再利用
            </span>
          )}
          {bytes != null && (
            <span>{Math.round(bytes / 1024 / 1024 * 10) / 10} MB</span>
          )}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden">
        {expired ? (
          <SessionCapOverlay maxSessionMin={maxSessionMin} />
        ) : status === 'ready' && clipId ? (
          <video
            key={clipId}
            src={`/api/vod/${clipId}`}
            controls
            autoPlay
            // F79.1: `muted` is required for browsers to allow autoplay.
            // Without it, Chrome / Safari / Firefox block the auto-start
            // (because the file has an AAC track from Frigate, even when
            // silent) and the video pauses on the first frame — looks like
            // a static image. The user can unmute via the controls bar.
            muted
            playsInline
            className="h-full w-full bg-black"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-slate-300">
            <ProgressCard
              status={status}
              error={error}
              incidentIso={incidentIso}
            />
          </div>
        )}
      </div>

      {/* Footer breadcrumb back-link (replaces the legacy chrome's home arrow) */}
      <div className="border-t border-slate-800 bg-slate-900 px-4 py-1.5 text-[11px]">
        <Link href={`/stores/${storeId}`} className="text-blue-400 hover:underline">
          ← 16分割に戻る
        </Link>
      </div>
    </div>
  )
}

function ProgressCard({
  status, error, incidentIso,
}: {
  status: ClipStatus | 'creating' | 'timeout'
  error:  string | null
  incidentIso: string | null
}) {
  if (status === 'creating' || status === 'queued') {
    return (
      <div className="max-w-sm rounded bg-slate-800/80 px-5 py-4 ring-1 ring-slate-700">
        <div className="mb-1 font-semibold">録画クリップを準備中…</div>
        <div className="text-xs text-slate-400">
          エッジサーバが NVR から該当区間を取得しています。通常 5〜30 秒。
        </div>
        {incidentIso && (
          <div className="mt-2 text-[11px] text-amber-400">
            事案発生時刻: {fmtJst(incidentIso)}
          </div>
        )}
      </div>
    )
  }
  if (status === 'uploading') {
    return (
      <div className="max-w-sm rounded bg-slate-800/80 px-5 py-4 ring-1 ring-slate-700">
        <div className="mb-1 font-semibold">Storage にアップロード中…</div>
        <div className="text-xs text-slate-400">
          まもなく再生可能になります。
        </div>
      </div>
    )
  }
  if (status === 'timeout') {
    return (
      <div className="max-w-md rounded bg-amber-950/90 px-5 py-4 text-amber-100 ring-1 ring-amber-700">
        <div className="mb-1 font-semibold">タイムアウト</div>
        <div className="text-xs text-amber-200">
          90秒以内にアップロードが完了しませんでした。範囲を短くするか、しばらく待ってからやり直してください。
        </div>
      </div>
    )
  }
  // failed
  return (
    <div className="max-w-md rounded bg-red-950/90 px-5 py-4 text-red-100 ring-1 ring-red-700">
      <div className="mb-1 font-semibold">再生できません</div>
      <div className="text-xs text-red-200">
        {error ?? '不明なエラー'}
      </div>
      <div className="mt-2 text-[11px] text-red-300">
        よくある原因: 録画が該当区間にない / Frigate API が応答していない / Storage 認証エラー
      </div>
    </div>
  )
}
