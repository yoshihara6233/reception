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

interface Props {
  cameraId:      string
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

export default function FrigateHlsPlayer({ cameraId, frigateCamera, fromIso, name, channel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [base, setBase] = useState<Date>(() => new Date(fromIso))
  const [status, setStatus] = useState<'loading' | 'playing' | 'failed'>('loading')

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
  }, [cameraId, frigateCamera, base])

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
        <span className="ml-auto text-[10px] text-slate-400">Frigate ネイティブHLS・シーク可</span>
      </div>
      <div className="relative flex-1 bg-black">
        <video ref={videoRef} controls playsInline className="h-full w-full bg-black object-contain" />
        {status === 'loading' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/70">
            読み込み中…
          </div>
        )}
        {status === 'failed' && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/80">
            この時間帯の録画が見つかりません。別の時間を選んでください。<br />
            ※初回はカメラ側（Cloudflare Access）の認可が必要な場合があります。
          </div>
        )}
      </div>
    </div>
  )
}
