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
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { RotateCw } from 'lucide-react'
import { RemoteHlsVideo } from '@/components/video/RemoteHlsVideo'
import { useRemoteVideoSession } from '@/components/video/useRemoteVideoSession'
import { describeVideoError } from '@/lib/video/session-logic'

const RESUME_REOPEN_MS = 10_000
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** ISO → datetime-local の値（JST・秒まで）。 */
function toJstInput(iso: string): string {
  return new Date(new Date(iso).getTime() + JST_OFFSET_MS).toISOString().slice(0, 19)
}
/** datetime-local の値（JST）→ ISO。読めなければ null。 */
function fromJstInput(v: string): string | null {
  const d = new Date(`${v.length === 16 ? `${v}:00` : v}+09:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
function fmtJst(d: Date): string {
  const p = new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZone: 'Asia/Tokyo',
  }).format(d)
  return p.replace(/-/g, '/')
}

interface Props {
  cameraId: string
  /** 無ければ 15 分前から（時刻は画面で指定し直せる） */
  initialFrom: string | null
  initialTo: string | null
}

export default function RemoteHlsVodPlayer({ cameraId, initialFrom, initialTo }: Props) {
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
    setPlayFailed(false)
    setPlaying(null)
    playingRef.current = null
    setInput(toJstInput(iso))
    setRange({ from: iso, to: undefined })
    setAttempt((n) => n + 1)
  }, [])

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
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-ge-dark-bg px-3 py-1.5 text-[12px] text-slate-300">
        <label className="flex items-center gap-1.5">
          <span>再生の開始</span>
          <input
            type="datetime-local"
            step={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="rounded border border-white/15 bg-transparent px-1.5 py-0.5 font-ge-mono text-[12px] tabular-nums text-slate-100 [color-scheme:dark]"
          />
        </label>
        <button
          type="button"
          onClick={() => { const iso = fromJstInput(input); if (iso) openAt(iso) }}
          className="rounded border border-ge-dark-accent px-2 py-0.5 text-slate-100 hover:bg-white/5"
        >
          この時刻から再生
        </button>
        <span className="mx-1 h-4 w-px bg-white/10" aria-hidden />
        {([[-300, '5 分戻る'], [-30, '30 秒戻る'], [30, '30 秒進む'], [300, '5 分進む']] as const).map(([d, label]) => (
          <button
            key={d}
            type="button"
            onClick={() => jump(d)}
            className="rounded border border-white/10 px-2 py-0.5 hover:bg-white/5"
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-slate-400">
          録画の時刻{' '}
          <span className="font-ge-mono tabular-nums text-slate-200">{playing ? fmtJst(playing) : '—'}</span>
          {phase === 'ended' && <span className="ml-2">範囲の終わりまで受け取りました</span>}
        </span>
      </div>

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
