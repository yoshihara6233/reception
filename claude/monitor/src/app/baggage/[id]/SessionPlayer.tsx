'use client'

/**
 * 2カメラ同期プレイヤー（M4・SCREEN H v2）
 *
 * 同一検査窓を写す最大2クリップを、共有スクラバ1本で同期再生する。
 * クリップは同じ window_from/to で切り出されるため、currentTime を素通しで揃える
 * （細かいドリフトは seek 時に再同期）。src は署名URLプロキシ（/api/baggage/clips/[id]）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface PlayerClip {
  id: string
  cameraName: string
  src: string
  durationSec: number | null
}

export function SessionPlayer({ clips, windowLabel }: { clips: PlayerClip[]; windowLabel: string }) {
  const refs = useRef<(HTMLVideoElement | null)[]>([])
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const videos = () => refs.current.filter(Boolean) as HTMLVideoElement[]

  // 最長クリップを基準に総尺を決める（メタデータ読込後）
  const onLoaded = useCallback(() => {
    const d = Math.max(0, ...videos().map((v) => (Number.isFinite(v.duration) ? v.duration : 0)))
    if (d > 0) setDuration(d)
  }, [])

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => {
      const v = videos()[0]
      if (v) setTime(v.currentTime)
    }, 250)
    return () => clearInterval(t)
  }, [playing])

  const toggle = useCallback(() => {
    const vs = videos()
    if (vs.length === 0) return
    if (playing) { vs.forEach((v) => v.pause()); setPlaying(false); return }
    vs.forEach((v) => { void v.play().catch(() => {}) })
    setPlaying(true)
  }, [playing])

  const seek = useCallback((t: number) => {
    videos().forEach((v) => { v.currentTime = t })
    setTime(t)
  }, [])

  const onEnded = useCallback(() => { setPlaying(false) }, [])

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  if (clips.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="flex aspect-video flex-col items-center justify-center gap-1 rounded bg-gedbg text-sm text-gedaccent">
            <span>カメラ{i + 1}</span>
            <span className="text-[11px] text-gedink3">{windowLabel}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className={`grid grid-cols-1 gap-3 ${clips.length > 1 ? 'md:grid-cols-2' : ''}`}>
        {clips.slice(0, 2).map((c, i) => (
          <div key={c.id} className="overflow-hidden rounded bg-gedbg">
            <video
              ref={(el) => { refs.current[i] = el }}
              src={c.src}
              preload="metadata"
              playsInline
              muted={i > 0}   // 音声は1本目のみ（二重再生防止）
              onLoadedMetadata={onLoaded}
              onEnded={onEnded}
              className="aspect-video w-full"
            />
            <div className="px-3 py-1.5 text-[11px] text-gedink2">{c.cameraName}</div>
          </div>
        ))}
      </div>

      {/* 共有スクラバ */}
      <div className="flex items-center gap-4 rounded border border-slate-200 bg-white px-4 py-2.5 text-[13px] text-slate-600 dark:border-gedline dark:bg-gedbg2 dark:text-gedink2">
        <button
          onClick={toggle}
          aria-label={playing ? '一時停止' : '再生'}
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-300 hover:bg-slate-50 dark:border-gedline dark:hover:bg-gedbg3"
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="4" width="5" height="16" /><rect x="14" y="4" width="5" height="16" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l14 8-14 8z" /></svg>
          )}
        </button>
        <span className="font-mono tabular-nums">{fmt(time)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.1)}
          step={0.1}
          value={Math.min(time, duration)}
          onChange={(e) => seek(Number(e.target.value))}
          className="h-1 flex-1 accent-blue-800"
        />
        <span className="font-mono tabular-nums">{fmt(duration)}</span>
        <span className="hidden text-slate-500 dark:text-gedink3 md:inline">{windowLabel}</span>
      </div>
    </div>
  )
}
