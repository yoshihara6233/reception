'use client'

/**
 * 遠隔の録画再生（HLS）— G・VMS の拠点が録画を区切りにして送る（GVMS_CLOUD_SPEC §5.3）。
 *
 * 決まり（§5.3.2）:
 *  - 拠点は再生の速さの 1.5 倍までで先読みして送る。置き場は 16 の輪番なので、
 *    **長く止めると置き場が上書きされる**。10 秒を超える一時停止のあとは、止めた時刻から
 *    セッションを開き直す。
 *  - シーク（30 秒・5 分の移動、時刻の指定）も新しいセッションを開き直す。倍速は無い。
 *  - 範囲の終わりで拠点は ended を報告する。手元の再生は最後の区切りまで続く。
 *
 * 操作の並びはライブの画面と共通（PlaybackBar）。今より先へ進めたときと「ライブに戻る」は
 * 同じカメラのライブへ移る（2026-09-26 利用者の要望）。
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { RotateCw } from 'lucide-react'
import { PlaybackBar } from '@/components/video/PlaybackBar'
import { RemoteHlsVideo } from '@/components/video/RemoteHlsVideo'
import { useRemoteVideoSession } from '@/components/video/useRemoteVideoSession'
import { describeVideoError } from '@/lib/video/session-logic'
import { fromJstInput, isLiveEdge, liveHref, toJstInput } from '@/lib/video/playback-nav'

const RESUME_REOPEN_MS = 10_000
function fmtJst(d: Date): string {
  const p = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'Asia/Tokyo',
  }).format(d)
  return p.replace(/-/g, '/')
}

interface Props {
  storeId: string
  cameraId: string
  /** 無ければ 15 分前から（時刻は画面で指定し直せる） */
  initialFrom: string | null
  initialTo: string | null
}

export default function RemoteHlsVodPlayer({ storeId, cameraId, initialFrom, initialTo }: Props) {
  const router = useRouter()
  const toLive = () => router.push(liveHref(storeId, cameraId))
  const [range, setRange] = useState<{ from: string; to: string | undefined }>(() => ({
    from: initialFrom ?? new Date(Date.now() - 15 * 60_000).toISOString(),
    to: initialFrom ? initialTo ?? undefined : undefined,
  }))
  const [attempt, setAttempt] = useState(0)
  const [input, setInput] = useState(() => toJstInput(range.from))
  const [playing, setPlaying] = useState<Date | null>(null)
  const [playFailed, setPlayFailed] = useState(false)
  const pausedRef = useRef<{ at: number; date: Date | null } | null>(null)
  const playingRef = useRef<Date | null>(null)

  const req = useMemo(() => ({ cameraId, kind: 'hls_vod' as const, from: range.from, to: range.to }), [cameraId, range])
  const { phase, src, failure } = useRemoteVideoSession(req, attempt)

  /** 指定の時刻から開き直す（to は指定し直しのたびに既定の 60 分に戻す）。 */
  const openAt = useCallback((iso: string) => {
    // 今（か今より先）は録画ではまだ送れない → ライブへ
    if (isLiveEdge(iso)) { router.push(liveHref(storeId, cameraId)); return }
    setPlayFailed(false)
    setPlaying(null)
    playingRef.current = null
    setInput(toJstInput(iso))
    setRange({ from: iso, to: undefined })
    setAttempt((n) => n + 1)
  }, [router, storeId, cameraId])

  const jump = (deltaSec: number) => {
    const base = playingRef.current ?? new Date(range.from)
    openAt(new Date(base.getTime() + deltaSec * 1000).toISOString())
  }

  const onPauseChange = (paused: boolean) => {
    if (paused) {
      pausedRef.current = { at: Date.now(), date: playingRef.current }
      return
    }
    const p = pausedRef.current
    pausedRef.current = null
    if (p?.date && Date.now() - p.at > RESUME_REOPEN_MS) openAt(p.date.toISOString())
  }

  const errorCode = playFailed ? 'play_failed' : failure ? failure.code : null

  return (
    <div className="relative flex h-full flex-col bg-black">
      <PlaybackBar
        input={input}
        onInput={setInput}
        onPlayFromInput={() => { const iso = fromJstInput(input); if (iso) openAt(iso) }}
        onJump={jump}
        extra={
          <>
            <span className="mx-1 h-4 w-px bg-white/10" aria-hidden />
            <button
              type="button"
              onClick={toLive}
              className="rounded border border-white/10 px-2 py-0.5 hover:bg-white/5"
            >
              ライブに戻る
            </button>
          </>
        }
        right={
          <>
            録画の時刻{' '}
            <span className="font-ge-mono tabular-nums text-slate-200">{playing ? fmtJst(playing) : '—'}</span>
            {phase === 'ended' && <span className="ml-2">範囲の終わりまで受け取りました</span>}
          </>
        }
      />

      <div className="relative min-h-0 flex-1">
        {src && !playFailed && (
          <RemoteHlsVideo
            src={src}
            live={false}
            onFatal={() => setPlayFailed(true)}
            onPlayingDate={(d) => { playingRef.current = d; setPlaying(d) }}
            onPauseChange={onPauseChange}
          />
        )}
        {phase === 'starting' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded bg-black/60 px-4 py-2 text-[13px] text-slate-200">拠点に録画の送信を依頼しています…</div>
          </div>
        )}
        {errorCode && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 px-6 text-center text-[13px] text-slate-200">
            <div>{errorCode === 'play_failed' ? '動画を再生できませんでした' : describeVideoError(errorCode)}</div>
            {errorCode !== 'no_recording' && (
              <button
                type="button"
                onClick={() => openAt(playingRef.current?.toISOString() ?? range.from)}
                className="inline-flex items-center gap-1.5 rounded border border-slate-600 px-3 py-1.5 text-[12px] text-slate-100 hover:bg-white/10"
              >
                <RotateCw className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                再試行
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
