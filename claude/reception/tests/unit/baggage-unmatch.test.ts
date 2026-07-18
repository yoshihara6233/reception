/**
 * 日次バッチ純ロジックのユニット（T7）
 */
import { describe, expect, test } from 'vitest'
import {
  jstDateStr, computeUnmatchedExits, retentionCutoffIso, buildUnmatchEmail,
} from '@/lib/baggage/unmatch'

describe('jstDateStr', () => {
  test('UTC深夜でも JST の日付になる', () => {
    // 2026-07-18T20:00:00Z は JST では 2026-07-19 05:00
    expect(jstDateStr(new Date('2026-07-18T20:00:00Z'))).toBe('2026-07-19')
  })
  test('前日オフセット', () => {
    expect(jstDateStr(new Date('2026-07-18T20:00:00Z'), -1)).toBe('2026-07-18')
  })
})

describe('computeUnmatchedExits', () => {
  test('入室ありexit無しの entered のみ拾う', () => {
    const ids = computeUnmatchedExits([
      { id: 'a', entry_at: '2026-07-18T00:00:00Z', exit_at: null, status: 'entered' },      // 対象
      { id: 'b', entry_at: '2026-07-18T00:00:00Z', exit_at: '2026-07-18T09:00:00Z', status: 'completed' }, // 退出済
      { id: 'c', entry_at: null, exit_at: '2026-07-18T09:00:00Z', status: 'unmatched_entry' },             // 入室無し
      { id: 'd', entry_at: '2026-07-18T00:00:00Z', exit_at: null, status: 'interrupted' },  // entered以外
    ])
    expect(ids).toEqual(['a'])
  })
  test('空配列は空', () => {
    expect(computeUnmatchedExits([])).toEqual([])
  })
})

describe('retentionCutoffIso', () => {
  test('保持日数ぶん過去のカットオフ', () => {
    const now = new Date('2026-07-18T00:00:00Z')
    expect(retentionCutoffIso(60, now)).toBe(new Date('2026-05-19T00:00:00Z').toISOString())
  })
  test('負値は0扱い（当日カットオフ）', () => {
    const now = new Date('2026-07-18T00:00:00Z')
    expect(retentionCutoffIso(-5, now)).toBe(now.toISOString())
  })
})

describe('buildUnmatchEmail', () => {
  test('0件は「ありませんでした」', () => {
    const { subject, html } = buildUnmatchEmail('渋谷店', '2026-07-18', [])
    expect(subject).toContain('0件')
    expect(html).toContain('ありませんでした')
  })
  test('件数と種別ラベルを含む', () => {
    const { subject, html } = buildUnmatchEmail('渋谷店', '2026-07-18', [
      { personLabel: '田中', kind: 'unmatched_exit', at: '2026-07-18T09:00:00Z' },
      { personLabel: '（未特定）', kind: 'unmatched_entry', at: null },
    ])
    expect(subject).toContain('2件')
    expect(html).toContain('退出なし')
    expect(html).toContain('入室記録なし')
    expect(html).toContain('田中')
  })
})
