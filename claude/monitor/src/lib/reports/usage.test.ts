import { describe, it, expect } from 'vitest'
import { confirmRatePct, monthBounds, trendBounds, rollupWindow, prevMonth } from './usage'

describe('confirmRatePct', () => {
  it('分母0は null', () => {
    expect(confirmRatePct(0, 0)).toBeNull()
    expect(confirmRatePct(5, 0)).toBeNull()
  })
  it('率を小数1桁で返す', () => {
    expect(confirmRatePct(1, 2)).toBe(50)
    expect(confirmRatePct(1, 3)).toBe(33.3)
    expect(confirmRatePct(2, 3)).toBe(66.7)
    expect(confirmRatePct(3, 3)).toBe(100)
  })
})

describe('monthBounds', () => {
  it('月初と月末（うるう年含む）', () => {
    expect(monthBounds(2026, 7)).toEqual({ from: '2026-07-01', to: '2026-07-31' })
    expect(monthBounds(2026, 2)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthBounds(2024, 2)).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    expect(monthBounds(2026, 4)).toEqual({ from: '2026-04-01', to: '2026-04-30' })
  })
})

describe('trendBounds', () => {
  it('終端月末までの直近Nヶ月（年跨ぎ）', () => {
    expect(trendBounds(2026, 7, 6)).toEqual({ from: '2026-02-01', to: '2026-07-31' })
    expect(trendBounds(2026, 2, 3)).toEqual({ from: '2025-12-01', to: '2026-02-28' })
    expect(trendBounds(2026, 1, 12)).toEqual({ from: '2025-02-01', to: '2026-01-31' })
  })
})

describe('rollupWindow', () => {
  it('今日から daysBack 日前まで（月跨ぎ）', () => {
    expect(rollupWindow('2026-07-25', 3)).toEqual({ from: '2026-07-22', to: '2026-07-25' })
    expect(rollupWindow('2026-07-02', 3)).toEqual({ from: '2026-06-29', to: '2026-07-02' })
    expect(rollupWindow('2026-07-25', 0)).toEqual({ from: '2026-07-25', to: '2026-07-25' })
  })
})

describe('prevMonth', () => {
  it('前月（年跨ぎ）', () => {
    expect(prevMonth(2026, 7)).toEqual({ year: 2026, month: 6 })
    expect(prevMonth(2026, 1)).toEqual({ year: 2025, month: 12 })
  })
})
