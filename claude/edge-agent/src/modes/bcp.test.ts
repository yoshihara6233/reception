/**
 * Tests for BCP snapshot capture timing (captureAtMs).
 *
 * Regression guard for investigate 2026-06-27 (event 1127abc5…): future
 * offsets (T+5 .. T+30) were captured at the exact target instant, leaving the
 * moment "live" (isPast=false). That skipped the NVR/Frigate historical path,
 * and NVR-backed onvif-generic cameras have no live snapshot fallback, so every
 * future offset failed ('no snapshot URL for vendor'). The fix: settle past the
 * moment so isPast=true and the recorded frame is pulled.
 *
 * The capture path (bcp.ts) treats a moment as past when
 *   targetMs < Date.now() - 5_000
 * so the settled capture time MUST land comfortably beyond target + 5s.
 */
import { describe, it, expect } from 'vitest'
import { captureAtMs } from './bcp-timing.js'

// Mirror of the isPast threshold in captureOneSnapshot.
const IS_PAST_THRESHOLD_MS = 5_000

describe('captureAtMs', () => {
  const alertMs = Date.parse('2026-06-27T08:32:00Z')

  it('captures past offsets (< 0) at the exact target moment', () => {
    expect(captureAtMs(-5, alertMs)).toBe(alertMs - 5 * 60_000)
  })

  it('settles future offsets (>= 0) past their target moment', () => {
    for (const offset of [0, 5, 10, 15, 20, 25, 30]) {
      const targetMs  = alertMs + offset * 60_000
      const captureMs = captureAtMs(offset, alertMs)
      // Must be strictly after the target...
      expect(captureMs).toBeGreaterThan(targetMs)
      // ...and far enough that isPast (target < captureMs - 5s) holds, i.e. the
      // historical capture path is reachable for every future offset.
      expect(targetMs).toBeLessThan(captureMs - IS_PAST_THRESHOLD_MS)
    }
  })

  it('honors a custom settle window', () => {
    expect(captureAtMs(10, alertMs, 90_000)).toBe(alertMs + 10 * 60_000 + 90_000)
  })
})
