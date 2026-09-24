import { describe, it, expect } from 'vitest'
import { EdgeConfigSchema } from './edge-config'

describe('EdgeConfigSchema（設定遠隔投入の許可キー）', () => {
  it('許可キーの正常値を通す', () => {
    const r = EdgeConfigSchema.safeParse({
      retention_days: 30, live_hevc_passthrough: false,
      motion_sensitivity: 0.3, snapshot_offsets: [-5, 5, 10, 30],
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
    expect(EdgeConfigSchema.safeParse({ motion_sensitivity: 1.5 }).success).toBe(false)
    expect(EdgeConfigSchema.safeParse({ snapshot_offsets: [99999] }).success).toBe(false)
  })

  it('型違いを拒否', () => {
    expect(EdgeConfigSchema.safeParse({ retention_days: '30' }).success).toBe(false)
    expect(EdgeConfigSchema.safeParse({ live_hevc_passthrough: 'yes' }).success).toBe(false)
  })
})
