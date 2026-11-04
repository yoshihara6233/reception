'use client'

/**
 * 「約 ○ 秒前の映像」の印 (2026-11-04・シナリオ試験の所見)。
 *
 * 監視の画面 (16 分割・単体の JPEG) を開いた直後は、エッジが新しい画像を上げるまで前回の
 * 画像が出る。見た目では今の映像と区別が付かなかったので、画像の置かれた時刻が
 * STALE_MS より古いときだけ印を出す。経過はサーバが計る (lib/storage/edge-image-age.ts)。
 * 経過が分からない (古い Worker など) ときは何も出さない (従来どおり)。
 */
import { useEffect, useState } from 'react'
import { Clock } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'

/** これより古い画像に印を付ける。エッジは 1〜2 秒ごとに上げるので、10 秒は明らかに止まっている。 */
export const STALE_MS = 10_000
/** 経過を尋ねる間隔。グリッドの更新 (5 秒) と同じ。 */
const POLL_MS = 5_000

/** 経過を表示の単位に丸める。純粋関数 (試験用に出す)。 */
export function frameAgeParts(ageMs: number): { n: number; unit: 'sec' | 'min' | 'hour' | 'day' } {
  const sec = Math.floor(ageMs / 1000)
  if (sec < 60) return { n: sec, unit: 'sec' }
  const min = Math.floor(sec / 60)
  if (min < 60) return { n: min, unit: 'min' }
  const hour = Math.floor(min / 60)
  if (hour < 24) return { n: hour, unit: 'hour' }
  return { n: Math.floor(hour / 24), unit: 'day' }
}

/**
 * 画像の経過 (ms) を定期的に尋ねる。endpoint は画像の受け口 (`/api/edges/<id>/grid` など)。
 * null を渡すと尋ねない。画面が裏にある間は止める。
 */
export function useFrameAge(endpoint: string | null): number | null {
  const [ageMs, setAgeMs] = useState<number | null>(null)
  useEffect(() => {
    if (!endpoint) return
    let alive = true
    const load = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      try {
        const r = await fetch(`${endpoint}?meta=1&_=${Date.now()}`, { cache: 'no-store' })
        if (!r.ok) return
        const j = (await r.json()) as { ageMs?: number | null }
        if (alive) setAgeMs(typeof j.ageMs === 'number' ? j.ageMs : null)
      } catch { /* 圏外など。印は前の値のまま */ }
    }
    void load()
    const iv = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(iv); setAgeMs(null) }
  }, [endpoint])
  return ageMs
}

export function FrameAgeBadge({ ageMs, className = '' }: { ageMs: number | null; className?: string }) {
  const { t } = useLang()
  if (ageMs == null || ageMs < STALE_MS) return null
  const { n, unit } = frameAgeParts(ageMs)
  return (
    <div
      role="status"
      title={t.workspace.frameAgeHint}
      className={'pointer-events-none inline-flex items-center gap-1 rounded bg-amber-900/80 px-2 py-0.5 text-[11px] font-medium text-amber-100 ring-1 ring-amber-700/60 ' + className}
    >
      <Clock size={12} strokeWidth={1.5} aria-hidden />
      {t.workspace.frameAge(n, unit)}
    </div>
  )
}
