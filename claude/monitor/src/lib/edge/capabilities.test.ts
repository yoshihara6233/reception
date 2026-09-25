import { describe, expect, it } from 'vitest'
import {
  LEGACY_CAPABILITIES, effectiveCapabilities, hasCapability, sanitizeCapabilities, sanitizeSpecVersion,
} from './capabilities'

describe('sanitizeCapabilities（§2: 知らない名前・崩れた名乗りで heartbeat を拒否しない）', () => {
  it('配列でなければ名乗り無し（null）', () => {
    expect(sanitizeCapabilities(undefined)).toBeNull()
    expect(sanitizeCapabilities('hls_live')).toBeNull()
    expect(sanitizeCapabilities({ a: 1 })).toBeNull()
  })

  it('知らない機能名もそのまま残す（捨てるのは形の合わない要素だけ）', () => {
    expect(sanitizeCapabilities(['grid', 'future_feature_x', 'hls_live'])).toEqual(['grid', 'future_feature_x', 'hls_live'])
  })

  it('形の合わない要素・重複を捨てる', () => {
    expect(sanitizeCapabilities(['grid', 'Grid', 'a-b', '', 1, null, 'x'.repeat(33), 'grid', 'sfu'])).toEqual(['grid', 'sfu'])
  })

  it('32 件で切る', () => {
    const many = Array.from({ length: 40 }, (_, i) => `c${i}`)
    expect(sanitizeCapabilities(many)).toHaveLength(32)
  })

  it('空配列は「何も名乗らない」として残す（名乗り無しとは別）', () => {
    expect(sanitizeCapabilities([])).toEqual([])
  })
})

describe('sanitizeSpecVersion', () => {
  it('正の整数だけ', () => {
    expect(sanitizeSpecVersion(1)).toBe(1)
    expect(sanitizeSpecVersion(0)).toBeNull()
    expect(sanitizeSpecVersion(1.5)).toBeNull()
    expect(sanitizeSpecVersion('1')).toBeNull()
    expect(sanitizeSpecVersion(undefined)).toBeNull()
  })
})

describe('effectiveCapabilities', () => {
  it('名乗りの無い nvmsd（0.1.67 以前）は既定の一覧 — 動画の機能は無い（§7-7）', () => {
    const caps = effectiveCapabilities({ agent_version: 'nvmsd/0.1.67', capabilities: null })
    expect(caps).toEqual(LEGACY_CAPABILITIES)
    expect(hasCapability({ agent_version: 'nvmsd/0.1.67', capabilities: null }, 'hls_live')).toBe(false)
  })

  it('名乗った nvmsd は名乗りのとおり', () => {
    const edge = { agent_version: 'nvmsd/0.1.68', capabilities: ['grid', 'hls_live'] }
    expect(hasCapability(edge, 'hls_live')).toBe(true)
    expect(hasCapability(edge, 'hls_vod')).toBe(false)
  })

  it('従来のエッジ端末は名乗りの仕組みの外（空）', () => {
    expect(effectiveCapabilities({ agent_version: '1.4.2', capabilities: ['hls_live'] })).toEqual([])
    expect(effectiveCapabilities(null)).toEqual([])
  })
})
