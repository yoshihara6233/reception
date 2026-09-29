'use client'

/**
 * 遠隔ライブ（SFU）— G・VMS の拠点から LiveKit へ送ってもらう低遅延の動画（GVMS_CLOUD_SPEC §5.4）。
 *
 * 見張りは HLS と共通（useRemoteVideoSession・kind 'sfu'）。クラウドが視聴 1 回ぶんの受け口と
 * 部屋（gvms_<session_id>）を作る。購読専用のトークンは**拠点が送り始める前に**届くので、
 * 先に部屋へ入っておき、拠点が WHIP で送り始めたら最初のキーフレームから映す（2026-09-29）。
 * 以前は送り始めを確かめてから部屋へ入っていたため、見張りの周期・部屋への接続（ICE・DTLS）・
 * 次のキーフレームの待ちが拠点の立ち上がりのあとに直列に乗っていた（本番の iPhone で 8 秒）。
 * 拠点はカメラの H.264 を変換せずに中継するときキーフレームを求められない（PLI に答えられない）ので、
 * 遅れて入ると次のキーフレーム（カメラの GOP）まで映らない。
 *
 * 部屋へ入れても映像が START_NO_MEDIA_MS 来なければ、拠点から応答が無いものとして見切る
 * （timeout・自動の再接続の対象）。
 *
 * 遅延は窓口ノードの H.264 で 1 秒未満、他ノードのカメラと H.265 は拠点での変換が入り 2〜3 秒。
 * 拠点が断った（busy / bandwidth / codec_unsupported）ときは onFallback で静止画ライブへ戻す。
 *
 * 従来のエッジ向け SFU（live-livekit-mode.tsx）と違い、画面を閉じたら視聴を止める
 * （拠点の同時視聴の枠を空ける・§5.1）。止めるのは useRemoteVideoSession の後始末。
 *
 * 回線が一時的に切れて部屋から外れた・送信が止まったときは、視聴を開き直して自動でつなぎ直す
 * （useAutoReconnect）。LiveKit 自身の立て直し（Reconnecting）で戻れなかったときだけ Disconnected が来る。
 * 間隔を伸ばし 2 分で諦めるので、切断→再接続の繰り返しにはならない。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client'
import { RotateCw, Image as ImageIcon } from 'lucide-react'
import { START_TIMEOUT_MS, useRemoteVideoSession } from '@/components/video/useRemoteVideoSession'
import { useAutoReconnect } from '@/components/video/useAutoReconnect'
import { describeVideoError } from '@/lib/video/session-logic'

/** 部屋へ入ってから映像を待つ上限。見張り側の開始の上限（25 秒）とそろえる。 */
const START_NO_MEDIA_MS = START_TIMEOUT_MS

interface Props {
  cameraId: string
  storeId: string
  /** 静止画ライブへ戻す（code は §5.1 の値） */
  onFallback: (code: string) => void
}

export default function RemoteSfuLiveMode({ cameraId, storeId, onFallback }: Props) {
  const [attempt, setAttempt] = useState(0)
  const [connFailed, setConnFailed] = useState<string | null>(null)
  /** 映像が出た attempt（開き直すと外れる） */
  const [playedAttempt, setPlayedAttempt] = useState<number | null>(null)
  const { livekit, failure, timing } = useRemoteVideoSession({ cameraId, kind: 'sfu' }, attempt)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [startedAt] = useState(() => Date.now())
  const ttffSent = useRef(false)
  // 見張り側の内訳は計測に添えるだけ（変わっても部屋へつなぎ直さない）
  const timingRef = useRef(timing)
  useEffect(() => { timingRef.current = timing })

  const fallbackRef = useRef(onFallback)
  useEffect(() => { fallbackRef.current = onFallback })
  useEffect(() => {
    if (failure?.fallback) fallbackRef.current(failure.code)
  }, [failure])

  useEffect(() => {
    if (!livekit) return
    let cancelled = false
    let played = false
    // adaptiveStream は使わない。拠点の送り出しは 1 本だけ（simulcast なし・受け口で変換しない）なので
    // 画質を選ぶ余地が無く、要素が見えるかを確かめてから購読を有効にする往復と、そのあとの
    // キーフレームの要求（拠点はカメラの中継では答えられない）で最初のフレームが遅れうる
    const room = new Room({ adaptiveStream: false })
    const video = videoRef.current
    const t0 = Date.now()
    let connectedMs: number | null = null
    let subscribedMs: number | null = null
    const noMedia = setTimeout(() => {
      if (!cancelled && !played) setConnFailed('no_media')
    }, START_NO_MEDIA_MS)
    const onVideoPlaying = () => {
      if (cancelled) return
      played = true
      clearTimeout(noMedia)
      setPlayedAttempt(attempt)
      // 初表示までの時間は最初の 1 回だけ（自動の再接続のたびに送ると値が崩れる）
      if (ttffSent.current) return
      ttffSent.current = true
      const tm = timingRef.current
      // 内訳（ms）: session=セッションが開けた / ready=トークンが届いた（見張りの始まりから）、
      // connected=部屋へ入れた / subscribed=映像のトラックが届いた（部屋へつなぎ始めてから）
      void fetch('/api/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'ttff_ms', storeId, cameraId, value: Date.now() - startedAt,
          meta: {
            transport: 'sfu_remote',
            session_ms: tm.sessionMs, ready_ms: tm.readyMs,
            connected_ms: connectedMs, subscribed_ms: subscribedMs, played_ms: Date.now() - t0,
          },
        }),
        keepalive: true,
      }).catch(() => {})
    }
    room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Video || !video) return
      subscribedMs ??= Date.now() - t0
      track.attach(video)
      video.addEventListener('playing', onVideoPlaying, { once: true })
    })
    room.on(RoomEvent.Disconnected, () => { if (!cancelled) setConnFailed('disconnected') })
    room.connect(livekit.url, livekit.token)
      .then(() => { connectedMs = Date.now() - t0 })
      .catch(() => { if (!cancelled) setConnFailed('connect') })
    return () => {
      cancelled = true
      clearTimeout(noMedia)
      video?.removeEventListener('playing', onVideoPlaying)
      void room.disconnect()
    }
  }, [livekit, attempt, cameraId, storeId, startedAt])

  const retry = useCallback(() => { setConnFailed(null); setAttempt((n) => n + 1) }, [])
  // 部屋へは入れたが映像が来ない = 拠点から応答が無い（timeout）。部屋へ入れない・切れた = sfu_connect
  const errorCode = connFailed === 'no_media' ? 'timeout'
    : connFailed ? 'sfu_connect'
    : failure && !failure.fallback ? failure.code : null
  const auto = useAutoReconnect({ attempt, errorCode, playing: playedAttempt === attempt, retry })

  return (
    <div className="relative h-full w-full bg-black">
      <video ref={videoRef} autoPlay muted playsInline className="h-full w-full bg-black object-contain" />
      {/* トークンは映る前に届く（先に部屋へ入る）ので、最初のフレームが出るまで出しておく */}
      {playedAttempt !== attempt && !errorCode && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded bg-black/60 px-4 py-2 text-[13px] text-slate-200">
            {auto.statusText ?? '拠点に映像の送信を依頼しています…'}
          </div>
        </div>
      )}
      {errorCode && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 px-6 text-center text-[13px] text-slate-200">
          <div role="status" aria-live="polite">
            {auto.statusText
              ?? (errorCode === 'sfu_connect' ? '映像の中継（SFU）へつなげませんでした' : describeVideoError(errorCode))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={auto.manualRetry}
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
