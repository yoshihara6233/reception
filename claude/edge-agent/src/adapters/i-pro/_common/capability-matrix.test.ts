/**
 * F46.17: capability matrix unit tests
 *
 * 純関数なので外部依存なし、実機なしで動く。
 * vitest で実行: bunx vitest run src/adapters/i-pro/_common/capability-matrix.test.ts
 *
 * 既存プロジェクトのテスト規約 (whip-proxy.test.ts 等) に合わせて vitest を採用。
 */
import { describe, expect, test } from 'vitest'
import type { FirmwareInfo } from '../../_base'
import { deriveCapabilities } from './capability-matrix'

function fw(modelFamily: string, modelNumber: string, fwVersion: string): FirmwareInfo {
  const m = fwVersion.match(/^(\d+)\.(\d+)(?:[.-](\d+))?/)
  return {
    vendor:      'i-pro',
    modelFamily,
    modelNumber,
    fwVersion,
    fwMajor:     m ? parseInt(m[1], 10) : 0,
    fwMinor:     m ? parseInt(m[2], 10) : 0,
    fwPatch:     m && m[3] ? parseInt(m[3], 10) : 0,
    detectedAt:  new Date(),
    source:      'cgi',
  }
}

describe('deriveCapabilities (i-PRO)', () => {

  test('v1.x WJ-NX300K (2018-2019)', () => {
    const caps = deriveCapabilities(fw('nx', 'WJ-NX300K', '1.20-0001'))
    expect(caps.supportsSnapshot).toBe(true)
    expect(caps.supportsVod).toBe(true)
    expect(caps.supportsAiMetadata).toBe(false)
    expect(caps.supportsActiveGuard).toBe(false)
    expect(caps.supportsAiOnIpro).toBe(false)
    expect(caps.maxResolution).toBe('1080p')
    expect(caps.maxChannels).toBe(16)
    expect(caps.maxVodHours).toBe(6)
    expect(caps.supportedCodecs).toEqual(['h264'])
  })

  test('v2.x WJ-NX300K (2020-2021)', () => {
    const caps = deriveCapabilities(fw('nx', 'WJ-NX300K', '2.50-0001'))
    expect(caps.supportsAiMetadata).toBe(true)
    expect(caps.supportsMotionZone).toBe(true)
    expect(caps.supportsActiveGuard).toBe(false)
    expect(caps.maxResolution).toBe('4K')
    expect(caps.maxChannels).toBe(32)
    expect(caps.maxVodHours).toBe(12)
    expect(caps.supportedCodecs).toEqual(['h264', 'h265'])
  })

  test('v3.x WJ-NX300K (2022+)', () => {
    const caps = deriveCapabilities(fw('nx', 'WJ-NX300K', '3.42-0001'))
    expect(caps.supportsActiveGuard).toBe(true)
    expect(caps.supportsTimelineSnapshot).toBe(true)
    expect(caps.supportsAiOnIpro).toBe(false)
    expect(caps.maxVodHours).toBe(24)
    expect(caps.maxConcurrentSessions).toBe(16)
    expect(caps.eventTypes).toContain('ai_person')
    expect(caps.eventTypes).toContain('ai_vehicle')
  })

  test('v4.x WJ-NX (2024+)', () => {
    const caps = deriveCapabilities(fw('nx', 'WJ-NX510K', '4.01-0001'))
    expect(caps.supportsAiOnIpro).toBe(true)
    expect(caps.rateLimitMs).toBe(100)
  })

  test('WJ-NU101K (4ch) — chan count 縮退', () => {
    const caps = deriveCapabilities(fw('nu', 'WJ-NU101K', '3.10-0001'))
    expect(caps.maxChannels).toBe(4)
    expect(caps.maxConcurrentSessions).toBeLessThanOrEqual(4)
  })

  test('WJ-NU201K (8ch) — chan count 縮退', () => {
    const caps = deriveCapabilities(fw('nu', 'WJ-NU201K', '3.20-0001'))
    expect(caps.maxChannels).toBe(8)
    expect(caps.maxConcurrentSessions).toBeLessThanOrEqual(4)
  })

  test('WJ-NU301K (16ch) — chan count 縮退', () => {
    const caps = deriveCapabilities(fw('nu', 'WJ-NU301K', '3.30-0001'))
    expect(caps.maxChannels).toBe(16)
    expect(caps.maxConcurrentSessions).toBeLessThanOrEqual(4)
  })

  test('WJ-GXE500 (アナログ→IP) — 限定 capability', () => {
    const caps = deriveCapabilities(fw('gxe', 'WJ-GXE500', '1.10-0001'))
    expect(caps.supportsSnapshot).toBe(true)
    expect(caps.supportsLiveRtsp).toBe(true)
    expect(caps.supportsVod).toBe(false)          // 録画なし
    expect(caps.supportsEventPush).toBe(false)    // event push なし
    expect(caps.maxChannels).toBe(4)
    expect(caps.maxResolution).toBe('1080p')
  })

  test('未知 FW (fwMajor=0) は CONSERVATIVE にフォールバック', () => {
    const caps = deriveCapabilities(fw('unknown', '?', '0.0-0000'))
    expect(caps.supportsVod).toBe(false)
    expect(caps.supportsAiMetadata).toBe(false)
    expect(caps.maxResolution).toBe('720p')
    expect(caps.maxChannels).toBe(4)
  })

  test('未知 modelFamily も CONSERVATIVE', () => {
    const caps = deriveCapabilities(fw('unknown', 'WJ-UNKNOWN', '5.0-0000'))
    expect(caps.supportsVod).toBe(false)
  })
})
