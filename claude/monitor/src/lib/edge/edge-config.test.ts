import { describe, it, expect } from 'vitest'
import { EdgeConfigSchema, allowedConfig } from './edge-config'

describe('EdgeConfigSchema（設定遠隔投入の許可キー）', () => {
  it('許可キーの正常値を通す', () => {
    const r = EdgeConfigSchema.safeParse({
      retention_days: 30, live_hevc_passthrough: false,
      snapshot_offsets: [-5, 5, 10, 30],
    })
    expect(r.success).toBe(true)
  })

  it('空オブジェクト（設定なし）を通す', () => {
    expect(EdgeConfigSchema.safeParse({}).success).toBe(true)
  })

  it('未知キーは拒否（strict）', () => {
    expect(EdgeConfigSchema.safeParse({ retention_days: 30, danger: 'x' }).success).toBe(false)
    // 任意コマンド系のキーを紛れ込ませても弾く
    expect(EdgeConfigSchema.safeParse({ exec: 'rm -rf /' }).success).toBe(false)
  })

  it('範囲外を拒否', () => {
    expect(EdgeConfigSchema.safeParse({ retention_days: 0 }).success).toBe(false)
    expect(EdgeConfigSchema.safeParse({ retention_days: 4000 }).success).toBe(false)
    expect(EdgeConfigSchema.safeParse({ snapshot_offsets: [99999] }).success).toBe(false)
    // nvmsd と同じ各 −60〜60 分（付録A.2）
    expect(EdgeConfigSchema.safeParse({ snapshot_offsets: [61] }).success).toBe(false)
    expect(EdgeConfigSchema.safeParse({ snapshot_offsets: [-61] }).success).toBe(false)
    expect(EdgeConfigSchema.safeParse({ snapshot_offsets: [-60, 60] }).success).toBe(true)
    // 0 個は不可（1〜12 個）
    expect(EdgeConfigSchema.safeParse({ snapshot_offsets: [] }).success).toBe(false)
  })

  it('motion_sensitivity は第1弾の契約から外した（付録A.2・未知キーとして拒否）', () => {
    expect(EdgeConfigSchema.safeParse({ motion_sensitivity: 0.3 }).success).toBe(false)
  })

  it('snapshot_offsets は重複除去＋昇順に正規化', () => {
    const r = EdgeConfigSchema.safeParse({ snapshot_offsets: [10, -5, 10, 5, -5] })
    expect(r.success && r.data.snapshot_offsets).toEqual([-5, 5, 10])
  })

  it('型違いを拒否', () => {
    expect(EdgeConfigSchema.safeParse({ retention_days: '30' }).success).toBe(false)
    expect(EdgeConfigSchema.safeParse({ live_hevc_passthrough: 'yes' }).success).toBe(false)
  })
})

describe('allowedConfig（配信直前のふるい）', () => {
  it('契約外キーと不正値を落とし、妥当なキーだけ残す', () => {
    expect(allowedConfig({
      retention_days: 30, motion_sensitivity: 0.3, live_hevc_passthrough: 'yes',
      snapshot_offsets: [5, -5, 5],
    })).toEqual({ retention_days: 30, snapshot_offsets: [-5, 5] })
  })
  it('null / 非オブジェクトは空', () => {
    expect(allowedConfig(null)).toEqual({})
    expect(allowedConfig('x')).toEqual({})
  })
})
