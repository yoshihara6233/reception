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
  normalizeInspectionWindow,
  MAX_INSPECTION_WINDOW_SEC,
  KIOSK_CLOCK_SKEW_SEC,
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

describe('検査の窓の組み合わせ（ASVS 2.2.3）', () => {
  const now = new Date('2026-10-30T03:00:00Z')
  const at = (sec: number) => new Date(now.getTime() + sec * 1000)

  test('ふつうの検査（数分・終わりが今）はそのまま通す', () => {
    expect(normalizeInspectionWindow(at(-180), at(0), now))
      .toEqual({ ok: true, startedAt: at(-180), endedAt: at(0), shifted: false })
    expect(normalizeInspectionWindow(at(0), at(0), now)).toMatchObject({ ok: true, shifted: false })
  })
  test('STEP 10 個 × 600 秒（100 分）の検査は通す', () => {
    expect(normalizeInspectionWindow(at(-6000), at(0), now)).toMatchObject({ ok: true, shifted: false })
  })
  test('キオスクの時計が数分ずれていてもそのまま通す', () => {
    expect(normalizeInspectionWindow(at(180), at(300), now)).toMatchObject({ ok: true, shifted: false })
    expect(normalizeInspectionWindow(at(-420), at(-300), now)).toMatchObject({ ok: true, shifted: false })
  })
  test('終わりが始まりより前は断る', () => {
    expect(normalizeInspectionWindow(at(0), at(-1), now)).toEqual({ ok: false, error: 'window_reversed' })
  })
  test('何日分もの窓は断る', () => {
    expect(normalizeInspectionWindow(at(-3 * 86400), at(0), now)).toEqual({ ok: false, error: 'window_too_long' })
    expect(normalizeInspectionWindow(at(-MAX_INSPECTION_WINDOW_SEC - 1), at(0), now))
      .toEqual({ ok: false, error: 'window_too_long' })
  })
  test('過去や先の時刻の窓は、長さを保ってサーバの今へ置き直す', () => {
    expect(normalizeInspectionWindow(at(-86400 - 60), at(-86400), now))
      .toEqual({ ok: true, startedAt: at(-60), endedAt: at(0), shifted: true })
    expect(normalizeInspectionWindow(at(86400), at(86400 + 90), now))
      .toEqual({ ok: true, startedAt: at(-90), endedAt: at(0), shifted: true })
    expect(normalizeInspectionWindow(at(-60), at(KIOSK_CLOCK_SKEW_SEC + 1), now)).toMatchObject({ ok: true, shifted: true })
  })
  test('日時として読めない値は断る', () => {
    expect(normalizeInspectionWindow(new Date('x'), at(0), now)).toEqual({ ok: false, error: 'window_invalid' })
  })
})
