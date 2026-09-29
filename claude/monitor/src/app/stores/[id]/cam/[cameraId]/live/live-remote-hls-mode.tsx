'use client'

/**
 * 遠隔ライブ（HLS）— G・VMS の拠点から送ってもらう動画（GVMS_CLOUD_SPEC §5.2）。
 *
 * 拠点は受信ポートを開けないので、映像は拠点から R2 の置き場へ上げてもらい、クラウドが
 * 中継する。遅延は 3〜6 秒（サブ映像のキーフレームの間隔で決まる・§5.6）。
 *
 * 拠点が断った（busy / bandwidth / codec_unsupported）ときは onFallback で静止画ライブへ
 * 戻す（§5.1）。それ以外の失敗はここで理由を出し、再試行と静止画ライブを選べるようにする。
 *
 * 回線が一時的に切れた（圏外・機内モード）ときは自動でつなぎ直す（useAutoReconnect）。
 * つなぎ直している間は失敗の文の代わりに状態を出し、手の「再試行」も残す。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCw, Image as ImageIcon } from 'lucide-react'
import { RemoteHlsVideo } from '@/components/video/RemoteHlsVideo'
import { useRemoteVideoSession } from '@/components/video/useRemoteVideoSession'
import { useAutoReconnect } from '@/components/video/useAutoReconnect'
import { describeVideoError } from '@/lib/video/session-logic'

interface Props {
  cameraId: string
  storeId: string
  /** 静止画ライブへ戻す（code は §5.1 の値） */
  onFallback: (code: string) => void
}

export default function RemoteHlsLiveMode({ cameraId, storeId, onFallback }: Props) {
  const [attempt, setAttempt] = useState(0)
  /** 再生の失敗（play_failed = 開き直せば直るかもしれない / play_unsupported = このブラウザでは無理） */
  const [playFailed, setPlayFailed] = useState<string | null>(null)
  /** 映像が出た attempt（開き直すと外れる） */
  const [playedAttempt, setPlayedAttempt] = useState<number | null>(null)
  const { phase, src, failure } = useRemoteVideoSession({ cameraId, kind: 'hls_live' }, attempt)
  const [startedAt] = useState(() => Date.now())
  const ttffSent = useRef(false)

  // 呼び出し側は描画ごとに新しい関数を渡すので、最新を ref で持って 1 度だけ呼ぶ
  const fallbackRef = useRef(onFallback)
  useEffect(() => { fallbackRef.current = onFallback })
  useEffect(() => {
    if (failure?.fallback) fallbackRef.current(failure.code)
  }, [failure])

  const retry = useCallback(() => { setPlayFailed(null); setAttempt((n) => n + 1) }, [])
  const onPlaying = () => {
    setPlayedAttempt(attempt)
    // 初表示までの時間は最初の 1 回だけ（自動の再接続のたびに送ると値が崩れる）
    if (ttffSent.current) return
    ttffSent.current = true
    void fetch('/api/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'ttff_ms', storeId, cameraId, value: Date.now() - startedAt, meta: { transport: 'hls_remote' } }),
      keepalive: true,
    }).catch(() => {})
  }

  const errorCode = playFailed ?? (failure && !failure.fallback ? failure.code : null)
  const auto = useAutoReconnect({ attempt, errorCode, playing: playedAttempt === attempt, retry })

  return (
    <div className="relative h-full w-full bg-black">
      {src && !playFailed && (
        <RemoteHlsVideo
          src={src}
          live
          onFatal={(kind) => setPlayFailed(kind === 'unsupported' ? 'play_unsupported' : 'play_failed')}
          onPlaying={onPlaying}
        />
      )}
      {phase === 'starting' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded bg-black/60 px-4 py-2 text-[13px] text-slate-200">
            {auto.statusText ?? '拠点に映像の送信を依頼しています…'}
          </div>
        </div>
      )}
      {errorCode && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 px-6 text-center text-[13px] text-slate-200">
          <div role="status" aria-live="polite">
            {auto.statusText ?? describePlayError(errorCode)}
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

function describePlayError(code: string): string {
  if (code === 'play_failed') return '動画を再生できませんでした'
  if (code === 'play_unsupported') return 'このブラウザでは動画を再生できません'
  return describeVideoError(code)
}
