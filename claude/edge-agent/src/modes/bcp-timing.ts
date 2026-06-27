/**
 * BCP snapshot capture timing — pure helpers, no I/O / config imports so they
 * stay unit-testable in isolation.
 */

/** Fixed snapshot offsets (minutes from the alert moment). */
export const SNAPSHOT_OFFSETS_MIN = [-5, 0, 5, 10, 15, 20, 25, 30] as const

// Future offsets (T+5 .. T+30) are captured *after* the moment has passed, not
// at the exact instant. Capturing at the instant leaves the moment "live"
// (isPast=false), which skips the NVR/Frigate historical path — and NVR-backed
// onvif-generic cameras have no live snapshot fallback, so those offsets fail
// outright. Settling past the moment (a) flips isPast=true so the historical
// path runs, and (b) gives the NVR time to flush that second to retrievable
// VOD. Must exceed the isPast threshold (5s) by a comfortable margin.
// See investigate 2026-06-27 (event 1127abc5…).
export const FUTURE_OFFSET_SETTLE_MS = 60_000

/**
 * When to actually capture a given offset. Future offsets (>= 0) are delayed
 * past their target moment by FUTURE_OFFSET_SETTLE_MS so the historical
 * (isPast) capture path is usable; past offsets (< 0) capture at the target.
 */
export function captureAtMs(
  offsetMin:     number,
  alertIssuedMs: number,
  settleMs:      number = FUTURE_OFFSET_SETTLE_MS,
): number {
  const targetMs = alertIssuedMs + offsetMin * 60_000
  return offsetMin >= 0 ? targetMs + settleMs : targetMs
}
