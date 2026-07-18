/**
 * クリップジョブ純ロジックのユニットテスト（T5）
 */
import { describe, expect, test } from 'vitest'
import {
  buildClipJobs,
  validateClipReport,
  nextRetryAt,
  isPastDeadline,
  RETRY_DELAYS_SEC,
} from '@/lib/baggage/clip-jobs'

const started = new Date('2026-07-18T09:00:00Z')
const ended = new Date('2026-07-18T09:01:40Z') // 100秒の検査

describe('buildClipJobs', () => {
  test('カメラ毎に1ジョブ・窓は±バッファ・not_before/deadline を算出', () => {
    const jobs = buildClipJobs(
      { inspectionStartedAt: started, inspectionEndedAt: ended, cameraIds: ['cam-1', 'cam-2'] },
      { preBufferSec: 15, postBufferSec: 15, notBeforeMin: 5, nvrRetentionDays: 14 },
    )
    expect(jobs).toHaveLength(2)
    const j = jobs[0]
    // window_from = started - 15s
    expect(j.windowFrom.toISOString()).toBe('2026-07-18T08:59:45.000Z')
    // window_to = ended + 15s
    expect(j.windowTo.toISOString()).toBe('2026-07-18T09:01:55.000Z')
    // not_before = window_to + 5min
    expect(j.notBefore.toISOString()).toBe('2026-07-18T09:06:55.000Z')
    // deadline = ended + (14-2)日
    expect(j.deadlineAt.toISOString()).toBe('2026-07-30T09:01:40.000Z')
    expect(jobs[1].cameraId).toBe('cam-2')
  })

  test('保持日数が2日以下でも deadline は過去に飛ばない（0日下限）', () => {
    const [j] = buildClipJobs(
      { inspectionStartedAt: started, inspectionEndedAt: ended, cameraIds: ['cam-1'] },
      { nvrRetentionDays: 1 },
    )
    // max(0, 1-2)=0 日 → deadline = ended
    expect(j.deadlineAt.getTime()).toBe(ended.getTime())
  })
})

describe('validateClipReport（尺80% / 時計ズレ）', () => {
  const windowFrom = new Date('2026-07-18T08:59:45Z')
  const windowTo = new Date('2026-07-18T09:01:55Z') // 130秒期待

  test('十分な尺・小さいoffset → ok', () => {
    const r = validateClipReport({ windowFrom, windowTo, reportedDurationSec: 128, clockOffsetSec: 0.8 })
    expect(r.ok).toBe(true)
    expect(r.expectedSec).toBe(130)
  })

  test('短尺（80%未満）→ 不健全', () => {
    const r = validateClipReport({ windowFrom, windowTo, reportedDurationSec: 100, clockOffsetSec: 0 })
    expect(r.ok).toBe(false)
    expect(r.reasons.join()).toMatch(/duration/)
  })

  test('時計ズレ超過 → 不健全（時間帯違いの疑い）', () => {
    const r = validateClipReport(
      { windowFrom, windowTo, reportedDurationSec: 130, clockOffsetSec: 9 },
      { maxOffsetSec: 3 },
    )
    expect(r.ok).toBe(false)
    expect(r.reasons.join()).toMatch(/offset/)
  })

  test('負方向の時計ズレも絶対値で判定', () => {
    const r = validateClipReport({ windowFrom, windowTo, reportedDurationSec: 130, clockOffsetSec: -9 })
    expect(r.ok).toBe(false)
  })
})

describe('バックオフ・期限', () => {
  const t0 = new Date('2026-07-18T10:00:00Z')

  test('nextRetryAt は retryCount に応じて遅延（頭打ちあり）', () => {
    expect(nextRetryAt(0, t0).getTime() - t0.getTime()).toBe(RETRY_DELAYS_SEC[0] * 1000)
    expect(nextRetryAt(2, t0).getTime() - t0.getTime()).toBe(RETRY_DELAYS_SEC[2] * 1000)
    // 上限を超えても最後の遅延で頭打ち
    expect(nextRetryAt(99, t0).getTime() - t0.getTime()).toBe(RETRY_DELAYS_SEC.at(-1)! * 1000)
    // 負値も 0 に丸める
    expect(nextRetryAt(-3, t0).getTime() - t0.getTime()).toBe(RETRY_DELAYS_SEC[0] * 1000)
  })

  test('isPastDeadline は超過を検出', () => {
    const deadline = new Date('2026-07-18T10:00:00Z')
    expect(isPastDeadline(deadline, new Date('2026-07-18T10:00:01Z'))).toBe(true)
    expect(isPastDeadline(deadline, new Date('2026-07-18T09:59:59Z'))).toBe(false)
  })
})
