import { describe, expect, it } from 'vitest'
import { defaultIssuedInput, issuedInputToIso } from './issued-at'

describe('テスト発令の発令日時 (JST)', () => {
  it('既定値は今の JST の時刻 (9 時間前ではない)', () => {
    // 2026-11-04 11:06:42 JST = 02:06:42 UTC
    const now = Date.UTC(2026, 10, 4, 2, 6, 42)
    expect(defaultIssuedInput(now)).toBe('2026-11-04T11:06')
  })

  it('日付をまたぐ時刻も JST で出す', () => {
    // 2026-11-04 00:30 JST = 2026-11-03 15:30 UTC
    expect(defaultIssuedInput(Date.UTC(2026, 10, 3, 15, 30, 5))).toBe('2026-11-04T00:30')
  })

  it('入力欄の値は JST として ISO にする', () => {
    expect(issuedInputToIso('2026-11-04T10:15')).toBe('2026-11-04T01:15:00.000Z')
    expect(issuedInputToIso('')).toBeNull()
  })

  it('既定値をそのまま送ると今の時刻 (分まで) になる', () => {
    const now = Date.UTC(2026, 10, 4, 2, 6, 42)
    expect(issuedInputToIso(defaultIssuedInput(now))).toBe('2026-11-04T02:06:00.000Z')
  })
})
