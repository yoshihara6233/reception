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
import { captureAtMs, normalizeOffsets, DEFAULT_SNAPSHOT_OFFSETS } from './bcp-timing.js'

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

describe('normalizeOffsets', () => {
  it('falls back to the default set when empty/undefined', () => {
    expect(normalizeOffsets(undefined)).toEqual([...DEFAULT_SNAPSHOT_OFFSETS])
    expect(normalizeOffsets(null)).toEqual([...DEFAULT_SNAPSHOT_OFFSETS])
    expect(normalizeOffsets([])).toEqual([...DEFAULT_SNAPSHOT_OFFSETS])
  })

  it('keeps only allowed offsets, deduped and sorted ascending', () => {
    expect(normalizeOffsets([20, -5, 5, 5])).toEqual([-5, 5, 20])
  })

  it('drops out-of-set values and falls back if nothing valid remains', () => {
    expect(normalizeOffsets([3, 7, 99])).toEqual([...DEFAULT_SNAPSHOT_OFFSETS])
    expect(normalizeOffsets([3, 30])).toEqual([30])
  })
})

/**
 * Regression guard: every vendor must have a BCP snapshot path.
 *
 * `i-pro-nvr`（カメラ網が業務網から分離され、エッジから NVR にしか到達できない
 * 現場向けの構成）が captureOneSnapshot の分岐から丸ごと抜けており、その構成では
 * BCP が全滅していた。しかも失敗するのは発災した瞬間だけで、平時は気づけない。
 * 判定は網羅 switch なので新ベンダはコンパイルエラーになるが、各ベンダの答えも
 * ここで固定しておく。
 */
import { hasBcpSnapshotPath, bcpUnavailableReason } from './bcp-capability.js'
import type { Vendor } from '../types.js'

const ALL_VENDORS: Vendor[] = ['ipro', 'uniview', 'frigate', 'onvif-generic', 'i-pro-nvr']

describe('hasBcpSnapshotPath', () => {
  it.each(['ipro', 'uniview', 'frigate', 'i-pro-nvr'] as Vendor[])(
    'has a path for %s without an explicit NVR',
    (vendor) => {
      expect(hasBcpSnapshotPath({ vendor, vodHost: null })).toBe(true)
    },
  )

  it('requires an NVR for onvif-generic — camera-direct has no recording', () => {
    expect(hasBcpSnapshotPath({ vendor: 'onvif-generic', vodHost: null })).toBe(false)
    expect(hasBcpSnapshotPath({ vendor: 'onvif-generic', vodHost: 'nvr.local' })).toBe(true)
  })

  it('covers every vendor once an NVR is configured', () => {
    for (const vendor of ALL_VENDORS) {
      expect(hasBcpSnapshotPath({ vendor, vodHost: 'nvr.local' })).toBe(true)
    }
  })

  it('names the vendor in the failure reason so logs are actionable', () => {
    expect(bcpUnavailableReason({ vendor: 'onvif-generic', vodHost: null }))
      .toContain('vod_host')
  })
})
