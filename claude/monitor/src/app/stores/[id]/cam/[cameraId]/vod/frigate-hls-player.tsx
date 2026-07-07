'use client'

/**
 * Frigate 録画再生（ネイティブHLS）。
 *
 * Frigate の録画は時(hour)単位の fMP4 HLS（H.264・シーク可）として配信される：
 *   /api/vod-hls/<cameraId>/vod/<YYYY-MM>/<DD>/<HH>/<frigate_camera>/UTC/master.m3u8
 * を hls.js で再生する。clip.mp4 取得＋再エンコード＋アップロード（90秒上限）を回避でき、
 * 5分以上でもスムーズ＋シーク可。URL の日付/時は **UTC** で組み立てる（Frigateの仕様）。
 *
 * UX: 「時」単位で読み込み、選択時刻のオフセットへ自動シーク。前後1時間ボタンと
 * datetime-local（ローカル時刻）で移動できる。
 */
import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { useSessionCountdown } from '@/lib/useSessionCountdown'
import { RemainingBadge, SessionCapOverlay } from '@/components/SessionCap'

interface Props {
  cameraId:      string
  storeId:       string
  frigateCamera: string
  fromIso:       string      // 開始時刻（この「時」を読み込む）
  name:          string
  channel:       number
}

/** その時刻が属する「時(hour)」の master.m3u8 URL（UTC）。 */
function hourUrl(cameraId: string, frigateCamera: string, d: Date): string {
  const Y = d.getUTCFullYear()
  const M = String(d.getUTCMonth() + 1).padStart(2, '0')
  const D = String(d.getUTCDate()).padStart(2, '0')
  const H = String(d.getUTCHours()).padStart(2, '0')
  return `/api/vod-hls/${cameraId}/vod/${Y}-${M}/${D}/${H}/${frigateCamera}/UTC/master.m3u8`
}

/** datetime-local（ローカル時刻）用の value 文字列。 */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function FrigateHlsPlayer({ cameraId, storeId, frigateCamera, fromIso, name, channel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [base, setBase] = useState<Date>(() => new Date(fromIso))
  const [status, setStatus] = useState<'loading' | 'playing' | 'failed'>('loading')

  // ── 視聴セッション（アクセスログ + 同時上限 F-10 + 時間上限 R1）─────────────
  // vod-player と同じ統制を HLS 経路にも適用する（無いと Frigate HLS 再生だけが
  // ログ/上限をバイパスしてしまう）。時単位ナビゲーションを跨いでも 1 セッション。
  const sessionId = useRef<string | null>(null)
  const [limitReached, setLimitReached]   = useState(false)
  const [maxSessionMin, setMaxSessionMin] = useState<number | null>(null)
  const [startedAtMs, setStartedAtMs]     = useState<number | null>(null)

  function endSession() {
    const sid = sessionId.current
    if (!sid) return
    sessionId.current = null
    void fetch('/api/sessions', {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      JSON.stringify({ action: 'end', id: sid }),
      keepalive: true,
    }).catch(() => {})
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/sessions', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ action: 'start', mode: 'vod', storeId, cameraId, vodFrom: fromIso }),
        })
        if (cancelled) return
        if (res.status === 429) { setLimitReached(true); return }
        if (res.ok) {
          const j = await res.json().catch(() => null) as { id?: string; maxSessionMin?: number | null } | null
          if (!cancelled && j?.id) {
            sessionId.current = j.id
            setMaxSessionMin(j.maxSessionMin ?? null)
            setStartedAtMs(Date.now())
          }
        }
      } catch { /* 上限チェックの一時失敗では再生を止めない(可用性優先) */ }
    })()
    return () => { cancelled = true; endSession() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, cameraId])

  // R1: 時間上限到達でセッション終了＋再生停止（video を SessionCapOverlay に差し替え）。
  const { remainingSec, expired } = useSessionCountdown(startedAtMs, maxSessionMin)
  useEffect(() => {
    if (expired) endSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const url     = hourUrl(cameraId, frigateCamera, base)
    const seekSec = base.getUTCMinutes() * 60 + base.getUTCSeconds()
    setStatus('loading')

    const onPlaying = () => setStatus('playing')
    video.addEventListener('playing', onPlaying)

    let hls: Hls | null = null
    if (Hls.isSupported()) {
      hls = new Hls({ maxBufferLength: 30, manifestLoadingMaxRetry: 1 })
      hls.loadSource(url)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        try { if (seekSec > 0) video.currentTime = seekSec } catch { /* noop */ }
        video.play().catch(() => {})
      })
      hls.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) setStatus('failed') })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari ネイティブHLS
      video.src = url
      const onMeta = () => {
        try { if (seekSec > 0) video.currentTime = seekSec } catch { /* noop */ }
        video.play().catch(() => {})
      }
      video.addEventListener('loadedmetadata', onMeta, { once: true })
    } else {
      setStatus('failed')
    }

    return () => {
      video.removeEventListener('playing', onPlaying)
      if (hls) hls.destroy()
    }
    // expired を deps に含める: 上限到達で video が unmount された際に cleanup で
    // hls を destroy し、バッファリングを確実に止める（次回実行は video=null で早期 return）。
  }, [cameraId, frigateCamera, base, expired])

  const shiftHour = (delta: number) =>
    setBase((prev) => new Date(prev.getTime() + delta * 3_600_000))

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs">
        <button onClick={() => shiftHour(-1)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">◀ 前の1時間</button>
        <input
          type="datetime-local"
          value={toLocalInput(base)}
          onChange={(e) => { const v = e.target.value; if (v) setBase(new Date(v)) }}
          className="rounded border border-slate-300 px-2 py-1"
        />
        <button onClick={() => shiftHour(1)} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">次の1時間 ▶</button>
        <button onClick={() => setBase(new Date())} className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50">直近</button>
        <span className="ml-1 text-slate-500">
          録画再生(HLS) — ch{String(channel).padStart(2, '0')} {name}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <RemainingBadge remainingSec={expired ? null : remainingSec} />
          <span className="text-[10px] text-slate-400">Frigate ネイティブHLS・シーク可</span>
        </span>
      </div>
      <div className="relative flex-1 bg-black">
        {limitReached ? (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="max-w-md rounded-lg bg-amber-950/90 px-5 py-4 text-center text-sm text-amber-100 ring-1 ring-amber-700">
              <div className="text-base font-semibold">同時視聴の上限に達しました</div>
              <p className="mt-2 text-xs text-amber-200">
                他の端末・タブの視聴を終了してから、もう一度開いてください。
              </p>
            </div>
          </div>
        ) : expired ? (
          <SessionCapOverlay maxSessionMin={maxSessionMin} />
        ) : (
          <>
            <video ref={videoRef} controls playsInline className="h-full w-full bg-black object-contain" />
            {status === 'loading' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/70">
                読み込み中…
              </div>
            )}
            {status === 'failed' && (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80">
                この時間帯の録画が見つかりません。別の時間を選んでください。<br />
                ※録画保持期間外、またはこの時間帯にカメラがオフラインだった可能性があります。
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
