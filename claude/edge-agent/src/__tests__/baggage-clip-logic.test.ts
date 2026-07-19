/**
 * 手荷物検査クリップ純ロジック（@intereco/shared/baggage）を edge 側からも検証。
 *
 * 目的:
 *   (1) edge が `@intereco/shared/baggage` サブパスを解決できること（配線スモーク）
 *   (2) clip-jobs ワーカが依存する尺検査・バックオフ・期限の契約が monitor と一致すること
 */
import { describe, expect, test } from 'vitest'
import {
  validateClipReport, nextRetryAt, isPastDeadline, RETRY_DELAYS_SEC,
} from '@intereco/shared/baggage'

describe('尺検査（80%）', () => {
  const windowFrom = new Date('2026-07-18T08:59:45Z')
  const windowTo = new Date('2026-07-18T09:01:55Z') // 130s
  test('十分な尺は ok（done にする）', () => {
    expect(validateClipReport({ windowFrom, windowTo, reportedDurationSec: 128, clockOffsetSec: 0 }).ok).toBe(true)
  })
  test('短尺は不健全（未確定録画 → 再試行）', () => {
    expect(validateClipReport({ windowFrom, windowTo, reportedDurationSec: 100, clockOffsetSec: 0 }).ok).toBe(false)
  })
})

describe('バックオフ・期限', () => {
  const t0 = new Date('2026-07-18T10:00:00Z')
  test('retry_count に応じて後ろ倒し（頭打ちあり）', () => {
    expect(nextRetryAt(1, t0).getTime() - t0.getTime()).toBe(RETRY_DELAYS_SEC[1] * 1000)
    expect(nextRetryAt(99, t0).getTime() - t0.getTime()).toBe(RETRY_DELAYS_SEC.at(-1)! * 1000)
  })
  test('deadline 超過を検出', () => {
    expect(isPastDeadline(t0, new Date('2026-07-18T10:00:01Z'))).toBe(true)
    expect(isPastDeadline(t0, new Date('2026-07-18T09:59:59Z'))).toBe(false)
  })
})
