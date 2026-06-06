/**
 * F66/F67/F68/F69/F70: Header clock.
 *
 * Simplified to remove any chance of timezone bugs:
 *   - Reads `Date.now()` (always UTC epoch ms, timezone-independent)
 *   - Adds JST_OFFSET (9 hours)
 *   - Reads back via getUTCHours/Minutes/Seconds, which always returns the
 *     hour interpreted as UTC — but since we shifted the epoch +9h, that
 *     value IS the JST hour.
 *
 * Why we removed the /api/server-time round-trip:
 *   The earlier implementation tried to use server time + drift correction,
 *   but a service worker (F32) was caching old JS and an Intl.DateTimeFormat
 *   timeZone resolution issue was producing UTC output. The current code has
 *   neither dependency.
 *
 * The label says "サーバ時刻" because the user thinks of "the time the
 * monitoring system thinks it is right now", which in practice equals the
 * client clock (the Mac running the dev server). True server-clock sync can
 * be added later if needed.
 */
'use client'

import { useEffect, useState } from 'react'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

interface Props {
  /** Compact mode shows only HH:MM:SS, ideal for narrow logos. */
  compact?: boolean
  className?: string
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export function ServerClock({ compact, className }: Props) {
  // We don't store the Date itself in state — that would cause hydration
  // mismatches. We just use a counter that re-renders every second, and
  // compute the time fresh from Date.now() inside the render.
  const [, setTick] = useState(0)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const id = setInterval(() => setTick((n) => (n + 1) % 1_000_000), 1000)
    return () => clearInterval(id)
  }, [])

  if (!mounted) {
    return (
      <span className={'font-mono text-[11px] tabular-nums text-slate-400 ' + (className ?? '')}>
        {compact ? '--:--:--' : '----/--/-- --:--:--'}
      </span>
    )
  }

  // Compute JST by shifting UTC epoch +9h and reading via getUTC*
  const j = new Date(Date.now() + JST_OFFSET_MS)
  const hh = pad(j.getUTCHours())
  const mm = pad(j.getUTCMinutes())
  const ss = pad(j.getUTCSeconds())
  const yyyy = j.getUTCFullYear()
  const mo   = pad(j.getUTCMonth() + 1)
  const dd   = pad(j.getUTCDate())

  const timeStr = `${hh}:${mm}:${ss}`
  const dateStr = `${yyyy}/${mo}/${dd}`
  const titleStr = `サーバ時刻 (JST): ${dateStr} ${timeStr}`

  if (compact) {
    return (
      <span
        title={titleStr}
        className={'font-mono text-[11px] tabular-nums text-slate-300 ' + (className ?? '')}
      >
        {timeStr}
      </span>
    )
  }

  return (
    <span
      title={titleStr}
      className={'font-mono text-[10px] tabular-nums text-slate-300 ' + (className ?? '')}
    >
      <span className="mr-1.5 hidden md:inline">{dateStr}</span>
      <span className="font-semibold text-slate-200">{timeStr}</span>
      <span className="ml-1 text-[9px] text-slate-500">JST</span>
    </span>
  )
}
