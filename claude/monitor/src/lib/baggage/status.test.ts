/**
 * 状態バッジ辞書のユニット（M2・standalone 版から移植・D7①）
 */
import { describe, expect, test } from 'vitest'
import {
  sessionBadge,
  clipBadge,
  filterPredicate,
  SESSION_STATUS,
} from './status'

describe('セッションバッジ', () => {
  test('既知状態のラベル・トーン', () => {
    expect(sessionBadge('completed')).toMatchObject({ label: '完了', tone: 'ok' })
    expect(sessionBadge('interrupted').tone).toBe('warn')
    expect(sessionBadge('unmatched_exit').tone).toBe('bad')
  })
  test('未知状態は muted フォールバック', () => {
    expect(sessionBadge('???')).toMatchObject({ tone: 'muted' })
  })
  test('藍(accent)は状態色に使わない（processing クリップのみ許容）', () => {
    for (const def of Object.values(SESSION_STATUS)) {
      expect(def.tone).not.toBe('accent')
    }
  })
})

describe('クリップバッジ（2本の upload_status から導出）', () => {
  test('0本done → 処理中', () => {
    expect(clipBadge([]).label).toBe('処理中')
    expect(clipBadge(['uploading', 'pending']).label).toBe('処理中')
  })
  test('1本done → 一部のみ', () => {
    expect(clipBadge(['done', 'uploading']).label).toBe('一部のみ')
  })
  test('2本done → 2/2', () => {
    expect(clipBadge(['done', 'done']).label).toBe('2/2')
  })
  test('1カメラ店舗: expected=1 で done に到達しラベルは 1/1（永遠の一部のみ回帰防止）', () => {
    expect(clipBadge(['done'], 1).label).toBe('1/1')
    expect(clipBadge(['done'], 1).tone).toBe('ok')
    expect(clipBadge(['uploading'], 1).label).toBe('処理中')
  })
  test('failed かつ未達 → 取得失敗', () => {
    expect(clipBadge(['failed', 'uploading']).label).toBe('取得失敗')
    // 片方 failed でももう片方 done で2本揃わなければ failed
    expect(clipBadge(['failed', 'done']).label).toBe('取得失敗')
  })
})

describe('履歴フィルタ述語', () => {
  test('completed / unmatched / interrupted は status 条件', () => {
    expect(filterPredicate('completed')).toEqual({ kind: 'status', values: ['completed'] })
    expect(filterPredicate('unmatched')).toEqual({ kind: 'status', values: ['unmatched_entry', 'unmatched_exit'] })
  })
  test('auth_skipped / unconfirmed は専用述語', () => {
    expect(filterPredicate('auth_skipped')).toEqual({ kind: 'auth_skipped' })
    expect(filterPredicate('unconfirmed')).toEqual({ kind: 'unconfirmed' })
  })
  test('all は条件なし', () => {
    expect(filterPredicate('all')).toEqual({ kind: 'none' })
  })
})
