'use client'

/**
 * 遠隔視聴の HLS を再生する <video>（ライブ・録画再生の共通）。
 *
 * src はクラウドの中継（/api/video/sessions/<id>/hls/index.m3u8）で同一オリジン。
 * プレイリストが届いてから渡される（useRemoteVideoSession）。
 *
 * ライブは hls.js の liveSyncDurationCount を 2 に詰める（仕様 §5.6 の推奨。既定 3 より
 * 遅延が区切り 1 本ぶん縮む。1 にすると区切りの到着の揺らぎで止まりやすい）。
 */
import { useEffect, useRef } from 'react'
import Hls from 'hls.js'

interface Props {
  src: string
  live: boolean
  /** 回復できない再生の失敗 */
  onFatal: () => void
  /** 最初のフレームが出た（初表示までの時間の計測用） */
  onPlaying?: () => void
  /** 録画再生で、いま映している録画の時刻（#EXT-X-PROGRAM-DATE-TIME 由来） */
  onPlayingDate?: (d: Date) => void
  /** 再生の一時停止・再開（録画再生は長い一時停止のあと開き直す・§5.3.2） */
  onPauseChange?: (paused: boolean) => void
}

export function RemoteHlsVideo({ src, live, onFatal, onPlaying, onPlayingDate, onPauseChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  // コールバックは描画ごとに変わるので ref で最新を持つ（src が同じなら張り直さない）
  const cb = useRef({ onFatal, onPlaying, onPlayingDate, onPauseChange })
  useEffect(() => { cb.current = { onFatal, onPlaying, onPlayingDate, onPauseChange } })

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let reported = false
    let hls: Hls | null = null
    const handlePlaying = () => {
      if (!reported) { reported = true; cb.current.onPlaying?.() }
    }
    const handleTime = () => {
      const d = hls?.playingDate
      if (d) cb.current.onPlayingDate?.(d)
    }
    const handlePause = () => cb.current.onPauseChange?.(true)
    const handlePlay = () => cb.current.onPauseChange?.(false)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('timeupdate', handleTime)
    video.addEventListener('pause', handlePause)
    video.addEventListener('play', handlePlay)
    const detach = () => {
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('timeupdate', handleTime)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('play', handlePlay)
    }

    if (!Hls.isSupported()) {
      // Safari は HLS をそのまま再生できる
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src
        video.play().catch(() => {})
        return () => { detach(); video.removeAttribute('src'); video.load() }
      }
      cb.current.onFatal()
      return detach
    }

    hls = new Hls(live ? { liveSyncDurationCount: 2 } : {})
    let mediaRetried = false
    hls.loadSource(src)
    hls.attachMedia(video)
    hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}) })
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data.fatal) return
      // 復号の乱れは 1 度だけ立て直す。それ以外（区切りが取れない等）は呼び出し側へ
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !mediaRetried) {
        mediaRetried = true
        hls?.recoverMediaError()
        return
      }
      cb.current.onFatal()
    })
    return () => { detach(); hls?.destroy() }
  }, [src, live])

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      controls
      className="h-full w-full bg-black object-contain"
    />
  )
}
