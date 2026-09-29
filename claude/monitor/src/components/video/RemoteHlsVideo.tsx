'use client'

/**
 * 遠隔視聴の HLS を再生する <video>（ライブ・録画再生の共通）。
 *
 * src はクラウドの中継（/api/video/sessions/<id>/hls/index.m3u8）で同一オリジン。
 * プレイリストが届いてから渡される（useRemoteVideoSession）。
 *
 * ライブは hls.js の liveSyncDurationCount を 2 に詰める（仕様 §5.6 の推奨。既定 3 より
 * 遅延が区切り 1 本ぶん縮む。1 にすると区切りの到着の揺らぎで止まりやすい）。
 *
 * 録画再生は**窓の頭（指定の時刻）から**再生する（startPosition: 0）。拠点のプレイリストは
 * 録画が続く間 #EXT-X-ENDLIST が無く、hls.js は生の配信とみなして終わりから区切り 3 本ぶん
 * 手前（4 秒の区切りで 12 秒・窓が進んでいればさらに先）から始めてしまう。拠点 0.1.75 からは
 * #EXT-X-START:TIME-OFFSET=0 も書くので同じ位置になるが、それより前の拠点でも頭から映すため
 * 明示する（§5.3.2）。頭から始めると、プレイリストが届いた時点の区切り 1 本目からすぐ映る。
 *
 * iPhone（iOS 17.1 以降）は ManagedMediaSource があるので hls.js で再生する
 * （hls.js 1.5 以降の既定 preferManagedMediaSource: true。Hls.isSupported() が true になる）。
 * Safari の素の HLS は再生を始める前に区切りを多めに待つため。ManagedMediaSource が無い
 * 古い iOS だけ素の HLS へ落とす。
 */
import { useEffect, useRef } from 'react'
import Hls from 'hls.js'

interface Props {
  src: string
  live: boolean
  /**
   * 回復できない再生の失敗。unsupported = このブラウザでは HLS を再生できない（やり直しても同じ）、
   * playback = 区切りが取れない等（回線が戻れば開き直しで直る。自動の再接続の対象）
   */
  onFatal: (kind: 'unsupported' | 'playback') => void
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
      // Safari は HLS をそのまま再生できる。失敗は <video> の error でしか分からないので拾う
      // （拾わないと、圏外で止まったまま自動の再接続が始まらない）
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        const handleError = () => cb.current.onFatal('playback')
        video.addEventListener('error', handleError)
        video.src = src
        video.play().catch(() => {})
        return () => {
          detach()
          video.removeEventListener('error', handleError)
          video.removeAttribute('src')
          video.load()
        }
      }
      cb.current.onFatal('unsupported')
      return detach
    }

    hls = new Hls(live ? { liveSyncDurationCount: 2 } : { startPosition: 0 })
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
      cb.current.onFatal('playback')
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
