'use client'

/**
 * 録画再生の操作の並び（開始時刻・この時刻から再生・5 分／30 秒の移動）。
 *
 * 録画再生の画面と単一カメラのライブの画面に、同じ並びを同じ位置で出す。
 * ライブではその先の映像が無いので「進む」を押せない状態で並べる（消すとボタンの
 * 位置が画面ごとに変わって迷う）。右端には各画面の情報（録画の時刻など）を入れる。
 */
import type { ReactNode } from 'react'

export const JUMPS = [[-300, '5 分戻る'], [-30, '30 秒戻る'], [30, '30 秒進む'], [300, '5 分進む']] as const

interface Props {
  /** 「再生の開始」の入力欄の値（datetime-local・JST） */
  input: string
  onInput: (v: string) => void
  /** 「この時刻から再生」 */
  onPlayFromInput: () => void
  onJump: (deltaSec: number) => void
  /** true なら「進む」を押せない（ライブの画面） */
  forwardDisabled?: boolean
  /** 移動ボタンの後ろに足すもの（録画再生の「ライブに戻る」） */
  extra?: ReactNode
  /** 右端 */
  right?: ReactNode
}

export function PlaybackBar({ input, onInput, onPlayFromInput, onJump, forwardDisabled, extra, right }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-ge-dark-bg px-3 py-1.5 text-[12px] text-slate-300">
      <label className="flex items-center gap-1.5">
        <span>再生の開始</span>
        <input
          type="datetime-local"
          step={1}
          value={input}
          onChange={(e) => onInput(e.target.value)}
          className="rounded border border-white/15 bg-transparent px-1.5 py-0.5 font-ge-mono text-[12px] tabular-nums text-slate-100 [color-scheme:dark]"
        />
      </label>
      <button
        type="button"
        onClick={onPlayFromInput}
        className="rounded border border-ge-dark-accent px-2 py-0.5 text-slate-100 hover:bg-white/5"
      >
        この時刻から再生
      </button>
      <span className="mx-1 h-4 w-px bg-white/10" aria-hidden />
      {JUMPS.map(([d, label]) => {
        const disabled = !!forwardDisabled && d > 0
        return (
          <button
            key={d}
            type="button"
            onClick={() => onJump(d)}
            disabled={disabled}
            title={disabled ? 'ライブより先の映像はありません' : undefined}
            className="rounded border border-white/10 px-2 py-0.5 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {label}
          </button>
        )
      })}
      {extra}
      {right && <span className="ml-auto text-[11px] text-slate-400">{right}</span>}
    </div>
  )
}
