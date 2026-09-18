import { describe, expect, it } from 'vitest'
import { inUpdateWindow, parseHhmm } from './update-window'

describe('parseHhmm', () => {
  it('HH:MM と HH:MM:SS（time 列の戻り）を分に変換する', () => {
    expect(parseHhmm('02:00')).toBe(120)
    expect(parseHhmm('05:00:00')).toBe(300)
    expect(parseHhmm('23:59')).toBe(1439)
  })
  it('null・壊れた値は null', () => {
    expect(parseHhmm(null)).toBeNull()
    expect(parseHhmm('')).toBeNull()
    expect(parseHhmm('25:00')).toBeNull()
    expect(parseHhmm('2:00')).toBeNull()
  })
})

describe('inUpdateWindow', () => {
  const min = (h: number, m = 0) => h * 60 + m

  it('未設定は既定 02:00-05:00 JST', () => {
    expect(inUpdateWindow(min(3), null, null)).toBe(true)
    expect(inUpdateWindow(min(2), null, null)).toBe(true)   // 開始は含む
    expect(inUpdateWindow(min(5), null, null)).toBe(false)  // 終了は含まない
    expect(inUpdateWindow(min(14), null, null)).toBe(false)
  })

  it('通常の帯（start < end）', () => {
    expect(inUpdateWindow(min(12, 30), '12:00', '13:00')).toBe(true)
    expect(inUpdateWindow(min(13), '12:00', '13:00')).toBe(false)
  })

  it('日跨ぎ（start > end）は wrap', () => {
    expect(inUpdateWindow(min(23, 30), '23:00', '04:00')).toBe(true)
    expect(inUpdateWindow(min(1), '23:00', '04:00')).toBe(true)
    expect(inUpdateWindow(min(12), '23:00', '04:00')).toBe(false)
  })

  it('start === end は終日可', () => {
    expect(inUpdateWindow(min(12), '03:00', '03:00')).toBe(true)
  })

  it('片側だけ壊れていても既定側で判定が壊れない', () => {
    expect(inUpdateWindow(min(3), 'xx', '05:00')).toBe(true) // start は既定 02:00 に倒れる
  })
})
