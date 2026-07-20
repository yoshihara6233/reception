import { describe, it, expect } from 'vitest'
import { isR2Path, r2Key, toR2Path } from './r2'

describe('R2 storage_path プレフィックス', () => {
  it('r2: プレフィックスを判定・剥がせる', () => {
    expect(isR2Path('r2:sess/cam.mp4')).toBe(true)
    expect(r2Key('r2:sess/cam.mp4')).toBe('sess/cam.mp4')
    expect(toR2Path('sess/cam.mp4')).toBe('r2:sess/cam.mp4')
  })

  it('旧 Supabase パスはそのまま（後方互換）', () => {
    expect(isR2Path('sess/cam.mp4')).toBe(false)
    expect(r2Key('sess/cam.mp4')).toBe('sess/cam.mp4')
    expect(isR2Path('failed/sess/cam')).toBe(false)
  })
})
