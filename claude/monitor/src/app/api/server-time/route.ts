/**
 * F68: GET /api/server-time
 *
 * Returns the server's current wall-clock time. The ServerClock component
 * calls this on mount, computes the drift vs the local clock, then ticks
 * forward using `Date.now() + drift` so the display reflects server time
 * regardless of how the client's clock is set.
 *
 * No auth — this is read-only and reveals no sensitive data.
 */
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'   // always fresh, never cache

export async function GET() {
  const now = new Date()
  return NextResponse.json(
    {
      iso:   now.toISOString(),
      epoch: now.getTime(),
      tz:    'Asia/Tokyo',
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    },
  )
}
