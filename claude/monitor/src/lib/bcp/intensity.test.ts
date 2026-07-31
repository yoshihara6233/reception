import { describe, expect, it } from 'vitest'
import { jmaIntensityLabel } from './intensity'

describe('jmaIntensityLabel', () => {
  it('JMA MaxInt 生値を日本語表記にする', () => {
    expect(jmaIntensityLabel('3')).toBe('震度3')
    expect(jmaIntensityLabel('5-')).toBe('震度5弱')
    expect(jmaIntensityLabel('5+')).toBe('震度5強')
    expect(jmaIntensityLabel('6-')).toBe('震度6弱')
    expect(jmaIntensityLabel('6+')).toBe('震度6強')
    expect(jmaIntensityLabel('7')).toBe('震度7')
  })

  it('null/未設定（津波・ミサイル等）は null', () => {
    expect(jmaIntensityLabel(null)).toBeNull()
    expect(jmaIntensityLabel(undefined)).toBeNull()
    expect(jmaIntensityLabel('')).toBeNull()
    expect(jmaIntensityLabel('  ')).toBeNull()
  })

  it('未知の値は生値のまま返す（将来の表記追加に安全側）', () => {
    expect(jmaIntensityLabel('8')).toBe('8')
  })
})
