'use client'

/**
 * 遠隔ライブ（SFU）— G・VMS の拠点から LiveKit へ送ってもらう低遅延の動画（GVMS_CLOUD_SPEC §5.4）。
 *
 * 見張りは HLS と共通（useRemoteVideoSession・kind 'sfu'）。クラウドが視聴 1 回ぶんの受け口と
 * 部屋（gvms_<session_id>）を作り、拠点が WHIP で送り始めたら購読専用のトークンが届く。
 * ここはそのトークンで部屋へつなぎ、映像を <video> へ付けるだけ。
 *
 * 遅延は窓口ノードの H.264 で 1 秒未満、他ノードのカメラと H.265 は拠点での変換が入り 2〜3 秒。
 * 拠点が断った（busy / bandwidth / codec_unsupported）ときは onFallback で静止画ライブへ戻す。
 *
 * 従来のエッジ向け SFU（live-livekit-mode.tsx）と違い、画面を閉じたら視聴を止める
 * （拠点の同時視聴の枠を空ける・§5.1）。止めるのは useRemoteVideoSession の後始末。
 */
import { useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client'
import { RotateCw, Image as ImageIcon } from 'lucide-react'
import { useRemoteVideoSession } from '@/components/video/useRemoteVideoSession'
import { describeVideoError } from '@/lib/video/session-logic'

interface Props {
  cameraId: string
  storeId: string
  /** 静止画ライブへ戻す（code は §5.1 の値） */
  onFallback: (code: string) => void
}

export default function RemoteSfuLiveMode({ cameraId, storeId, onFallback }: Props) {
  const [attempt, setAttempt] = useState(0)
  const [connFailed, setConnFailed] = useState<string | null>(null)
  const { phase, livekit, failure } = useRemoteVideoSession({ cameraId, kind: 'sfu' }, attempt)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [startedAt] = useState(() => Date.now())

  const fallbackRef = useRef(onFallback)
  useEffect(() => { fallbackRef.current = onFallback })
  useEffect(() => {
    if (failure?.fallback) fallbackRef.current(failure.code)
  }, [failure])

  useEffect(() => {
    if (!livekit) return
    let cancelled = false
    let reported = false
    const room = new Room({ adaptiveStream: true })
    const reportTtff = () => {
      if (reported || cancelled) return
      reported = true
      void fetch('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'ttff_ms', storeId, cameraId, value: Date.now() - startedAt, meta: { transport: 'sfu_remote' } }),
        keepalive: true,
      }).catch(() => {})
    }
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Video || !videoRef.current) return
      track.attach(videoRef.current)
      videoRef.current.addEventListener('playing', reportTtff, { once: true })
    })
    room.on(RoomEvent.Disconnected, () => { if (!cancelled) setConnFailed('disconnected') })
    room.connect(livekit.url, livekit.token).catch(() => { if (!cancelled) setConnFailed('connect') })
    return () => {
      cancelled = true
      void room.disconnect()
    }
  }, [livekit, cameraId, storeId, startedAt])

  const retry = () => { setConnFailed(null); setAttempt((n) => n + 1) }
  const errorCode = connFailed ? 'sfu_connect' : failure && !failure.fallback ? failure.code : null

  return (
    <div className="relative h-full w-full bg-black">
      <video ref={videoRef} autoPlay muted playsInline className="h-full w-full bg-black object-contain" />
      {phase === 'starting' && !errorCode && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded bg-black/60 px-4 py-2 text-[13px] text-slate-200">拠点に映像の送信を依頼しています…</div>
        </div>
      )}
      {errorCode && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 px-6 text-center text-[13px] text-slate-200">
          <div>
            {errorCode === 'sfu_connect' ? '映像の中継（SFU）へつなげませんでした' : describeVideoError(errorCode)}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={retry}
              className="inline-flex items-center gap-1.5 rounded border border-slate-600 px-3 py-1.5 text-[12px] text-slate-100 hover:bg-white/10"
            >
              <RotateCw className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              再試行
            </button>
            <button
              type="button"
              onClick={() => onFallback(errorCode)}
              className="inline-flex items-center gap-1.5 rounded border border-slate-600 px-3 py-1.5 text-[12px] text-slate-100 hover:bg-white/10"
            >
              <ImageIcon className="h-4 w-4" strokeWidth={1.5} aria-hidden />
              静止画ライブで見る
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
