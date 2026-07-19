/**
 * iPad 検査フロー純ロジックのユニット（M2・standalone 版から移植）
 */
import { describe, expect, test } from 'vitest'
import {
  availableActions,
  requiresInspection,
  isTempEvent,
  normalizeAnnounceSteps,
  advanceStep,
  firstStep,
  STEP_TEXT_MAX,
} from './inspection-flow'

describe('端末モード → 表示動作（D6/D17）', () => {
  test('both は4動作', () => {
    expect(availableActions('both')).toEqual(['entry', 'temp_exit', 'temp_return', 'exit'])
  })
  test('entry_only は入室・途中入室', () => {
    expect(availableActions('entry_only')).toEqual(['entry', 'temp_return'])
  })
  test('exit_only は退室・途中退室', () => {
    expect(availableActions('exit_only')).toEqual(['exit', 'temp_exit'])
  })
})

describe('検査要否・途中系判定', () => {
  test('検査STEPを伴うのは退室のみ', () => {
    expect(requiresInspection('exit')).toBe(true)
    expect(requiresInspection('entry')).toBe(false)
    expect(requiresInspection('temp_exit')).toBe(false)
  })
  test('途中系フラグ', () => {
    expect(isTempEvent('temp_exit')).toBe(true)
    expect(isTempEvent('temp_return')).toBe(true)
    expect(isTempEvent('exit')).toBe(false)
  })
})

describe('アナウンスSTEP正規化（D13）', () => {
  test('未設定は既定2STEP', () => {
    expect(normalizeAnnounceSteps(undefined)).toHaveLength(2)
    expect(normalizeAnnounceSteps([])).toHaveLength(2)
    expect(normalizeAnnounceSteps(null)[0].text).toBe('カバンの中身を出してください')
  })
  test('order昇順・空除外・order連番振り直し', () => {
    const steps = normalizeAnnounceSteps([
      { order: 3, text: 'C' }, { order: 1, text: 'A' }, { order: 2, text: '  ' },
    ])
    expect(steps.map((s) => s.text)).toEqual(['A', 'C'])
    expect(steps.map((s) => s.order)).toEqual([1, 2])
  })
  test('40字上限で切り詰め', () => {
    const long = 'あ'.repeat(60)
    const [s] = normalizeAnnounceSteps([{ order: 1, text: long }])
    expect(s.text.length).toBe(STEP_TEXT_MAX)
  })
})

describe('STEP進行', () => {
  const steps = normalizeAnnounceSteps([{ order: 1, text: 'A' }, { order: 2, text: 'B' }])
  test('最初のSTEP', () => {
    expect(firstStep(steps)).toEqual({ kind: 'step', index: 0, total: 2, text: 'A' })
  })
  test('次へで2番目→最終次へで完了', () => {
    expect(advanceStep(steps, 0)).toEqual({ kind: 'step', index: 1, total: 2, text: 'B' })
    expect(advanceStep(steps, 1)).toEqual({ kind: 'complete' })
  })
})
