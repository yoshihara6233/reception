// テスト発令の期限と詳細の自動の読み直し (2026-11-04・シナリオ試験の所見)
import { describe, it, expect } from 'vitest'
import { bcpListStatus, isStaleTestEvent, shouldAutoRefreshBcp, TEST_EVENT_STALE_MS } from './collecting'
import { aggregateBcpStatus } from './aggregate-status'

const NOW = Date.parse('2026-11-04T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('bcpListStatus', () => {
  it('24 時間を過ぎたテスト発令で収集の途中なら終了 (expired)', () => {
    for (const status of ['pending', 'recording', 'clips_uploaded']) {
      expect(bcpListStatus({ status, is_test: true, created_at: ago(TEST_EVENT_STALE_MS + 1) }, NOW)).toBe('expired')
    }
  })
  it('24 時間以内のテスト発令・本番の発令・決着した発令はそのまま', () => {
    expect(bcpListStatus({ status: 'recording', is_test: true, created_at: ago(60_000) }, NOW)).toBe('recording')
    expect(bcpListStatus({ status: 'recording', is_test: false, created_at: ago(TEST_EVENT_STALE_MS * 30) }, NOW)).toBe('recording')
    expect(bcpListStatus({ status: 'completed', is_test: true, created_at: ago(TEST_EVENT_STALE_MS * 30) }, NOW)).toBe('completed')
    expect(bcpListStatus({ status: 'failed', is_test: true, created_at: ago(TEST_EVENT_STALE_MS * 30) }, NOW)).toBe('failed')
  })
  it('isStaleTestEvent は本番を常に偽', () => {
    expect(isStaleTestEvent({ is_test: false, created_at: ago(TEST_EVENT_STALE_MS * 2) }, NOW)).toBe(false)
  })
})

describe('aggregateBcpStatus と expired', () => {
  it('全部が expired なら終了・完了と混ざれば一部', () => {
    expect(aggregateBcpStatus(['expired', 'expired'])).toBe('expired')
    expect(aggregateBcpStatus(['expired', 'completed'])).toBe('partial')
    expect(aggregateBcpStatus(['expired', 'recording'])).toBe('in_progress')
  })
})

describe('shouldAutoRefreshBcp', () => {
  const base = { is_test: true, created_at: ago(60_000), raw_purged_at: null }
  it('収集の途中の状態なら読み直す', () => {
    for (const status of ['pending', 'recording', 'clips_uploaded']) expect(shouldAutoRefreshBcp({ ...base, status }, false, NOW)).toBe(true)
  })
  it('途中で手で PDF を作った (report_generated) あとも、決着していないコマがあれば読み直す', () => {
    expect(shouldAutoRefreshBcp({ ...base, status: 'report_generated' }, true, NOW)).toBe(true)
    expect(shouldAutoRefreshBcp({ ...base, status: 'report_generated' }, false, NOW)).toBe(false)
  })
  it('完了・失敗・生画像の削除後・1 日を過ぎた発令は読み直さない', () => {
    expect(shouldAutoRefreshBcp({ ...base, status: 'completed' }, false, NOW)).toBe(false)
    expect(shouldAutoRefreshBcp({ ...base, status: 'failed' }, false, NOW)).toBe(false)
    expect(shouldAutoRefreshBcp({ ...base, status: 'recording', raw_purged_at: ago(0) }, true, NOW)).toBe(false)
    expect(shouldAutoRefreshBcp({ ...base, status: 'recording', created_at: ago(TEST_EVENT_STALE_MS + 1) }, true, NOW)).toBe(false)
  })
})
