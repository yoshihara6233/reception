'use client'

/**
 * C-2-4 複数カメラ同期再生（クライアント）。
 *
 * カメラ未選択時はピッカー（最大4ch＋開始時刻）→ 同ルートへ遷移。
 * 選択時は N面の <video>（Frigate 録画HLS）を1本の共有スクラバで同時刻シークする。
 *
 * 同期の要:
 *   Frigate 録画HLS は `/vod/<Y-M>/<D>/<H>/…/UTC/master.m3u8` と **UTC時**で配信されるため、
 *   全カメラが同じ UTC時を読み込めば `currentTime`(時内オフセット秒) が同一の壁時計を指す。
 *   → master(先頭video)の currentTime に他を追従させるだけで ch 間が揃う。
 *
 * セッション統制: 1ページ=1 vod セッション（同時上限F-10 / 時間上限R1 / アクセスログ）。
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Hls from 'hls.js'
import { useSessionCountdown } from '@/lib/useSessionCountdown'
import { RemainingBadge, SessionCapOverlay } from '@/components/SessionCap'

export interface MultiVodCam {
  cameraId:      string
  frigateCamera: string
  name:          string
  channel:       number
}

const MAX = 4
const SYNC_DRIFT_SEC = 0.4 // これを超える ch を master に引き戻す

function hourUrl(cameraId: string, frigateCamera: string, d: Date): string {
  const Y = d.getUTCFullYear()
  const M = String(d.getUTCMonth() + 1).padStart(2, '0')
  const D = String(d.getUTCDate()).padStart(2, '0')
  const H = String(d.getUTCHours()).padStart(2, '0')
  return `/api/vod-hls/${cameraId}/vod/${Y}-${M}/${D}/${H}/${frigateCamera}/UTC/master.m3u8`
}
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
function fmtOffset(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function MultiVodPlayer({
  storeId, candidates, selected, fromIso, incidentIso,
}: {
  storeId:     string
  candidates:  MultiVodCam[]
  selected:    MultiVodCam[]
  fromIso:     string
  incidentIso: string | null
}) {
  const router = useRouter()

  if (selected.length === 0) {
    return <Picker candidates={candidates} fromIso={fromIso} onGo={(ids, from) => {
      router.push(`/stores/${storeId}/multi-vod?cams=${ids.join(',')}&from=${encodeURIComponent(from)}`)
    }} />
  }
  return <SyncGrid storeId={storeId} cams={selected} fromIso={fromIso} incidentIso={incidentIso} />
}

// ─── カメラピッカー（汎用導線） ─────────────────────────────────────────────
function Picker({
  candidates, fromIso, onGo,
}: {
  candidates: MultiVodCam[]
  fromIso:    string
  onGo:       (ids: string[], fromIso: string) => void
}) {
  const [picked, setPicked] = useState<string[]>([])
  const [from, setFrom]     = useState(() => toLocalInput(new Date(fromIso)))

  function toggle(id: string) {
    setPicked((p) => p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX ? p : [...p, id])
  }
  function go() {
    if (picked.length < 1) return
    const iso = new Date(`${from}:00`).toISOString()
    onGo(picked, iso)
  }

  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="mb-1 text-sm font-semibold text-slate-900">同期再生するカメラを選択（最大{MAX}ch）</h1>
      <p className="mb-3 text-[11px] text-slate-500">選択したカメラの録画を同じ時刻から同時再生します。</p>
      <div className="mb-4 grid grid-cols-2 gap-2">
        {candidates.map((c) => {
          const on = picked.includes(c.cameraId)
          const full = !on && picked.length >= MAX
          return (
            <button
              key={c.cameraId}
              type="button"
              disabled={full}
              onClick={() => toggle(c.cameraId)}
              className={
                'flex items-center gap-2 rounded border px-3 py-2 text-left text-xs ' +
                (on ? 'border-blue-500 bg-blue-50 text-blue-800'
                    : full ? 'border-slate-200 bg-slate-50 text-slate-300'
                           : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')
              }
            >
              <span className="font-mono">ch{String(c.channel).padStart(2, '0')}</span>
              <span className="truncate">{c.name}</span>
              {on && <span className="ml-auto text-blue-600">✓</span>}
            </button>
          )
        })}
      </div>
      <label className="mb-1 block text-xs font-medium text-slate-600">開始時刻</label>
      <input
        type="datetime-local"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className="mb-4 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
      />
      <button
        type="button"
        onClick={go}
        disabled={picked.length < 1}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        同期再生 ({picked.length}/{MAX})
      </button>
    </div>
  )
}

// ─── 同期グリッド ───────────────────────────────────────────────────────────
function SyncGrid({
  storeId, cams, fromIso, incidentIso,
}: {
  storeId:     string
  cams:        MultiVodCam[]
  fromIso:     string
  incidentIso: string | null
}) {
  const [base, setBase]   = useState<Date>(() => new Date(fromIso))
  const [pos, setPos]     = useState(0)      // master の時内オフセット秒
  const [playing, setPlaying] = useState(false)
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([])
  const hlsRefs   = useRef<(Hls | null)[]>([])

  // セッション（1ページ=1 vod・R1/同時上限）。
  const sessionId = useRef<string | null>(null)
  const [limitReached, setLimitReached]   = useState(false)
  const [maxSessionMin, setMaxSessionMin] = useState<number | null>(null)
  const [startedAtMs, setStartedAtMs]     = useState<number | null>(null)

  function endSession() {
    const sid = sessionId.current
    if (!sid) return
    sessionId.current = null
    void fetch('/api/sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'end', id: sid }), keepalive: true,
    }).catch(() => {})
  }
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/sessions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start', mode: 'vod', storeId, cameraId: cams[0]?.cameraId, vodFrom: fromIso }),
        })
        if (cancelled) return
        if (res.status === 429) { setLimitReached(true); return }
        if (res.ok) {
          const j = await res.json().catch(() => null) as { id?: string; maxSessionMin?: number | null } | null
          if (!cancelled && j?.id) { sessionId.current = j.id; setMaxSessionMin(j.maxSessionMin ?? null); setStartedAtMs(Date.now()) }
        }
      } catch { /* 可用性優先 */ }
    })()
    return () => { cancelled = true; endSession() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId])

  const { remainingSec, expired } = useSessionCountdown(startedAtMs, maxSessionMin)
  useEffect(() => { if (expired) endSession() /* eslint-disable-next-line */ }, [expired])

  // base / cams 変更で全 ch のソースを（再）読込＋初期シーク。
  useEffect(() => {
    if (limitReached || expired) return
    const seek = base.getUTCMinutes() * 60 + base.getUTCSeconds()
    cams.forEach((cam, i) => {
      const v = videoRefs.current[i]
      if (!v) return
      hlsRefs.current[i]?.destroy()
      hlsRefs.current[i] = null
      const url = hourUrl(cam.cameraId, cam.frigateCamera, base)
      if (Hls.isSupported()) {
        const hls = new Hls({ maxBufferLength: 30, manifestLoadingMaxRetry: 1 })
        hlsRefs.current[i] = hls
        hls.loadSource(url)
        hls.attachMedia(v)
        hls.on(Hls.Events.MANIFEST_PARSED, () => { try { if (seek > 0) v.currentTime = seek } catch { /* noop */ } })
      } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = url
        const onMeta = () => { try { if (seek > 0) v.currentTime = seek } catch { /* noop */ } }
        v.addEventListener('loadedmetadata', onMeta, { once: true })
      }
    })
    setPos(seek)
    setPlaying(false)
    const hlsList = hlsRefs.current
    return () => { hlsList.forEach((h) => h?.destroy()); hlsRefs.current = [] }
  }, [base, cams, limitReached, expired])

  // 同期: master(先頭)の currentTime に他 ch を追従。
  useEffect(() => {
    const master = videoRefs.current[0]
    if (!master) return
    const onTime = () => {
      setPos(master.currentTime)
      for (let i = 1; i < videoRefs.current.length; i++) {
        const v = videoRefs.current[i]
        if (v && Math.abs(v.currentTime - master.currentTime) > SYNC_DRIFT_SEC) {
          try { v.currentTime = master.currentTime } catch { /* noop */ }
        }
      }
    }
    master.addEventListener('timeupdate', onTime)
    return () => master.removeEventListener('timeupdate', onTime)
  }, [cams])

  function playAll()  { videoRefs.current.forEach((v) => v?.play().catch(() => {})); setPlaying(true) }
  function pauseAll() { videoRefs.current.forEach((v) => v?.pause()); setPlaying(false) }
  function seekAll(sec: number) {
    videoRefs.current.forEach((v) => { if (v) { try { v.currentTime = sec } catch { /* noop */ } } })
    setPos(sec)
  }
  const shiftHour = (delta: number) => setBase((p) => new Date(p.getTime() + delta * 3_600_000))

  // 事案時刻が現在の時内なら、その offset を出す。
  const incidentOffset = (() => {
    if (!incidentIso) return null
    const inc = new Date(incidentIso)
    if (inc.getUTCFullYear() === base.getUTCFullYear() && inc.getUTCMonth() === base.getUTCMonth()
        && inc.getUTCDate() === base.getUTCDate() && inc.getUTCHours() === base.getUTCHours()) {
      return inc.getUTCMinutes() * 60 + inc.getUTCSeconds()
    }
    return null
  })()

  const cols = cams.length <= 1 ? 'grid-cols-1' : 'grid-cols-2'

  if (limitReached) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="max-w-md rounded-lg bg-amber-950/90 px-5 py-4 text-center text-sm text-amber-100 ring-1 ring-amber-700">
          <div className="text-base font-semibold">同時視聴の上限に達しました</div>
          <p className="mt-2 text-xs text-amber-200">他の端末・タブの視聴を終了してから、もう一度開いてください。</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-black">
      {/* 共有コントロールバー */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200">
        <button onClick={() => shiftHour(-1)} className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800">◀ 前の1時間</button>
        <input
          type="datetime-local"
          value={toLocalInput(base)}
          onChange={(e) => { const v = e.target.value; if (v) setBase(new Date(v)) }}
          className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100"
        />
        <button onClick={() => shiftHour(1)} className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800">次の1時間 ▶</button>
        <button onClick={() => setBase(new Date())} className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800">直近</button>
        <button onClick={() => (playing ? pauseAll() : playAll())} className="rounded bg-blue-600 px-3 py-1 font-semibold text-white hover:bg-blue-500">
          {playing ? '⏸ 一時停止' : '▶ 同期再生'}
        </button>
        {incidentOffset != null && (
          <button onClick={() => seekAll(incidentOffset)} className="rounded border border-amber-500 px-2 py-1 text-amber-300 hover:bg-amber-950">
            ⚑ 事案時刻へ
          </button>
        )}
        <span className="ml-auto flex items-center gap-2">
          <RemainingBadge remainingSec={expired ? null : remainingSec} />
          <span className="font-mono tabular-nums text-slate-400">{fmtOffset(pos)} / 60:00</span>
        </span>
      </div>

      {/* 共有スクラバ（時内 0..3600 秒） */}
      <div className="relative bg-slate-900 px-3 pb-2">
        <input
          type="range" min={0} max={3600} step={1} value={Math.min(3600, Math.round(pos))}
          onChange={(e) => seekAll(Number(e.target.value))}
          className="w-full accent-blue-500"
        />
        {incidentOffset != null && (
          <div className="pointer-events-none absolute top-0 h-2 w-0.5 bg-amber-400"
               style={{ left: `calc(0.75rem + ${(incidentOffset / 3600) * 100}% )` }} title="事案発生" />
        )}
      </div>

      {/* 同期グリッド */}
      <div className="relative flex-1 overflow-hidden p-1">
        {expired ? (
          <SessionCapOverlay maxSessionMin={maxSessionMin} />
        ) : (
          <div className={`grid h-full w-full gap-1 ${cols}`}>
            {cams.map((cam, i) => (
              <div key={cam.cameraId} className="relative min-h-0 bg-black">
                <video
                  ref={(el) => { videoRefs.current[i] = el }}
                  muted playsInline
                  className="h-full w-full bg-black object-contain"
                />
                <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-px text-[10px] text-white">
                  ch{String(cam.channel).padStart(2, '0')} {cam.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
