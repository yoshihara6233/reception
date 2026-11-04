// 「約 ○ 秒前の映像」の単位の丸め (2026-11-04・シナリオ試験の所見)
import { describe, it, expect } from 'vitest'
import { frameAgeParts, STALE_MS } from './FrameAgeBadge'
import { MESSAGES } from '@/lib/i18n/messages'

describe('frameAgeParts', () => {
  it('60 秒未満は秒・60 分未満は分・24 時間未満は時間・それ以上は日', () => {
    expect(frameAgeParts(12_400)).toEqual({ n: 12, unit: 'sec' })
    expect(frameAgeParts(59_999)).toEqual({ n: 59, unit: 'sec' })
    expect(frameAgeParts(60_000)).toEqual({ n: 1, unit: 'min' })
    expect(frameAgeParts(3 * 3_600_000 + 5)).toEqual({ n: 3, unit: 'hour' })
    expect(frameAgeParts(50 * 3_600_000)).toEqual({ n: 2, unit: 'day' })
  })
  it('印を出す境は 10 秒', () => {
    expect(STALE_MS).toBe(10_000)
  })
  it('日本語の文', () => {
    expect(MESSAGES.ja.workspace.frameAge(12, 'sec')).toBe('約 12 秒前の映像')
    expect(MESSAGES.ja.workspace.frameAge(1500, 'min')).toBe('約 1,500 分前の映像')
  })
})
