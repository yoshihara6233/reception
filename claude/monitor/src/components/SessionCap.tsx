'use client'

/**
 * R1: 視聴セッション時間上限の共通UI。
 *  - RemainingBadge: ツールバー等に置く残時間バッジ（残5分以内は警告色）。
 *  - SessionCapOverlay: 上限到達時に映像へ被せる「時間上限に達しました」オーバーレイ。
 */
import { formatRemaining } from '@/lib/useSessionCountdown'

/** 視聴セッションの残り時間バッジ。remainingSec が null の間は非表示。 */
export function RemainingBadge({ remainingSec }: { remainingSec: number | null }) {
  if (remainingSec == null) return null
  const warn = remainingSec <= 300
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums ' +
        (warn
          ? 'bg-amber-900/70 text-amber-100 ring-1 ring-amber-700/60'
          : 'bg-slate-700 text-slate-200')
      }
      title="この視聴セッションの残り時間（上限到達で自動終了します）"
    >
      ⏱ 残り {formatRemaining(remainingSec)}
    </span>
  )
}

/** 時間上限到達時のオーバーレイ。映像は停止済みの前提で被せる。 */
export function SessionCapOverlay({ maxSessionMin }: { maxSessionMin: number | null }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
      <div className="max-w-md rounded-lg bg-slate-900/92 px-5 py-4 text-center text-sm text-slate-100 ring-1 ring-slate-600">
        <div className="text-base font-semibold">視聴セッションの時間上限に達しました</div>
        <p className="mt-2 text-xs text-slate-300">
          1回の連続視聴は{maxSessionMin ? ` ${maxSessionMin} 分` : '一定時間'}までです
          （帯域とプライバシー保護のための制限）。続けて視聴するには開き直してください。
        </p>
        <div className="mt-3 flex justify-center gap-2">
          <button
            onClick={() => location.reload()}
            className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-500"
          >
            再開する
          </button>
          <button
            onClick={() => history.back()}
            className="rounded bg-slate-700 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-600"
          >
            戻る
          </button>
        </div>
      </div>
    </div>
  )
}
