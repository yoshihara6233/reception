'use client'

/**
 * SFU（LiveKit）購読モード（S2.1）。
 *
 * `/api/livekit/token` でカメラ由来 room の**購読トークン**を取得し、livekit-client で
 * 接続 → 映像トラックを <video> にアタッチする（H.264 サブ秒ライブ）。配信(publish)は
 * エッジ側（S1）が担う。機能フラグ OFF 時は親がこのモードを出さない（=ここは mount されない）。
 *
 * 実映像はエッジの publish（S1）稼働後に表示される。それまでは「配信待ち」を出す。
 * このコンポーネントは next/dynamic(ssr:false) で遅延読込され、SFU 未使用時は
 * livekit-client をバンドルに載せない。
 */
import { useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client'
import { cancelPendingStop } from '@/lib/edge-stop-registry'

type Status = 'connecting' | 'playing' | 'nomedia' | 'failed'

export default function LiveKitMode({ cameraId, edgeId }: { cameraId: string; edgeId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let room: Room | null = null
    let cancelled = false
    let mediaTimer: ReturnType<typeof setTimeout> | null = null

    // F75: 直前モード(軽量/高画質)の cleanup が予約した stop_stream を打ち消す。
    // これをしないと SFU 起動直後に stop_stream が飛び ffmpeg が即殺される
    // （"Immediate exit requested"）。他モードと同じ対処。
    cancelPendingStop(edgeId)

    // オンデマンド配信: 視聴開始でエッジに publish を要求（Ingress発行＋start_sfu）。
    // 離脱時に stop を要求してエッジを idle へ戻す（egress を止める）。best-effort。
    void fetch('/api/livekit/publish', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cameraId, action: 'start' }),
    }).catch(() => {})

    void (async () => {
      try {
        const res = await fetch('/api/livekit/token', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ cameraId }),
        })
        if (!res.ok) { if (!cancelled) setStatus('failed'); return }
        const { url, token } = (await res.json()) as { url?: string; token?: string }
        if (!url || !token) { if (!cancelled) setStatus('failed'); return }

        room = new Room({ adaptiveStream: true })
        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === Track.Kind.Video && videoRef.current) {
            track.attach(videoRef.current)
            if (!cancelled) { setStatus('playing'); if (mediaTimer) clearTimeout(mediaTimer) }
          }
        })
        room.on(RoomEvent.Disconnected, () => { if (!cancelled) setStatus('failed') })

        await room.connect(url, token)
        if (cancelled) { room.disconnect(); return }
        // 接続はできたが誰も publish していない（エッジ未配信）＝映像が来ない場合の案内。
        mediaTimer = setTimeout(() => {
          if (!cancelled) setStatus((s) => (s === 'playing' ? s : 'nomedia'))
        }, 8000)
      } catch {
        if (!cancelled) setStatus('failed')
      }
    })()

    return () => {
      cancelled = true
      if (mediaTimer) clearTimeout(mediaTimer)
      room?.disconnect()
      void fetch('/api/livekit/publish', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cameraId, action: 'stop' }), keepalive: true,
      }).catch(() => {})
    }
  }, [cameraId, edgeId, reloadKey])

  return (
    <div className="relative h-full w-full bg-black">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video ref={videoRef} autoPlay muted playsInline className="h-full w-full bg-black object-contain" />
      {status !== 'playing' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-6 text-center text-sm text-slate-200">
          {status === 'connecting' && <div>SFU に接続中…</div>}
          {status === 'nomedia' && (
            <div>配信待ち — このカメラのエッジがまだ SFU へ配信していません。</div>
          )}
          {status === 'failed' && (
            <div>SFU に接続できません（未有効化・権限・回線のいずれか）。</div>
          )}
          {status !== 'connecting' && (
            <button
              type="button"
              onClick={() => { setStatus('connecting'); setReloadKey((k) => k + 1) }}
              className="rounded bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-600"
            >
              🔄 再試行
            </button>
          )}
        </div>
      )}
    </div>
  )
}
