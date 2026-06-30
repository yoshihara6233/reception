import { describe, it, expect } from 'vitest'
import {
  initialState,
  shouldUpdateAgent,
  evaluateHealth,
  beginUpdate,
  enterPendingVerify,
  promoteHealthy,
  markRolledBack,
  verifyStep,
  OTA_DEFAULTS,
  type OtaState,
} from './core.js'

const NOW = '2026-06-30T00:00:00.000Z'
const LATER = '2026-06-30T00:05:00.000Z'

function freshState(running = 'sha0'): OtaState {
  return initialState(running, NOW)
}

describe('initialState', () => {
  it('現行版を known-good 兼用で idle 立ち上げ', () => {
    const s = freshState('sha0')
    expect(s).toMatchObject({
      running_version: 'sha0',
      known_good_version: 'sha0',
      pending_verify_version: null,
      last_failed_version: null,
      status: 'idle',
      attempts: 0,
    })
  })
})

describe('shouldUpdateAgent', () => {
  it('desired=null は更新しない', () => {
    expect(shouldUpdateAgent('sha0', null, freshState()).update).toBe(false)
  })
  it('desired==現行 は更新しない', () => {
    expect(shouldUpdateAgent('sha0', 'sha0', freshState())).toEqual({
      update: false,
      reason: 'already_current',
    })
  })
  it('desired!=現行 は更新する', () => {
    expect(shouldUpdateAgent('sha0', 'sha1', freshState())).toEqual({
      update: true,
      reason: 'desired_changed',
    })
  })
  it('updating 中は始めない（多重起動ガード）', () => {
    const s = { ...freshState(), status: 'updating' as const }
    expect(shouldUpdateAgent('sha0', 'sha1', s).update).toBe(false)
  })
  it('pending_verify 中は始めない', () => {
    const s = { ...freshState(), status: 'pending_verify' as const, pending_verify_version: 'sha1' }
    expect(shouldUpdateAgent('sha0', 'sha2', s).update).toBe(false)
  })
  it('ロールバック直後の同一 desired はクールダウンで再突入しない', () => {
    const s = { ...freshState(), status: 'rolled_back' as const, last_failed_version: 'sha-bad' }
    expect(shouldUpdateAgent('sha0', 'sha-bad', s)).toEqual({
      update: false,
      reason: 'cooldown_failed_version',
    })
  })
  it('ロールバック後でも desired が別版に変われば更新する', () => {
    const s = { ...freshState(), status: 'rolled_back' as const, last_failed_version: 'sha-bad' }
    expect(shouldUpdateAgent('sha0', 'sha-good', s).update).toBe(true)
  })
})

describe('evaluateHealth', () => {
  const min = OTA_DEFAULTS.MIN_STABLE_MS
  it('heartbeat到達かつ安定 → healthy', () => {
    expect(evaluateHealth({ heartbeatReached: true, stableMs: min, minStableMs: min }).verdict).toBe(
      'healthy',
    )
  })
  it('heartbeat到達だが安定不足 → pending', () => {
    expect(
      evaluateHealth({ heartbeatReached: true, stableMs: min - 1, minStableMs: min }).verdict,
    ).toBe('pending')
  })
  it('heartbeat未到達かつ猶予内 → pending', () => {
    expect(
      evaluateHealth({ heartbeatReached: false, stableMs: min - 1, minStableMs: min }).verdict,
    ).toBe('pending')
  })
  it('heartbeat未到達かつ猶予超過 → unhealthy', () => {
    expect(evaluateHealth({ heartbeatReached: false, stableMs: min, minStableMs: min })).toEqual({
      verdict: 'unhealthy',
      reason: 'no_heartbeat_within_window',
    })
  })
})

describe('状態遷移', () => {
  it('beginUpdate は pending_verify を記録し attempts を増やす', () => {
    const s = beginUpdate(freshState('sha0'), 'sha1', LATER)
    expect(s).toMatchObject({
      status: 'updating',
      pending_verify_version: 'sha1',
      attempts: 1,
      known_good_version: 'sha0',
    })
  })
  it('promoteHealthy は known-good を新版へ・クールダウン解除', () => {
    let s = beginUpdate(freshState('sha0'), 'sha1', LATER)
    s = enterPendingVerify(s, LATER)
    s = promoteHealthy(s, LATER)
    expect(s).toMatchObject({
      running_version: 'sha1',
      known_good_version: 'sha1',
      pending_verify_version: null,
      last_failed_version: null,
      status: 'healthy',
      attempts: 0,
    })
  })
  it('markRolledBack は known-good へ戻し失敗版を記録', () => {
    let s = beginUpdate(freshState('sha0'), 'sha-bad', LATER)
    s = enterPendingVerify(s, LATER)
    s = markRolledBack(s, 'no_heartbeat_within_window', LATER)
    expect(s).toMatchObject({
      running_version: 'sha0', // known-good に戻る
      known_good_version: 'sha0',
      pending_verify_version: null,
      last_failed_version: 'sha-bad',
      status: 'rolled_back',
      last_error: 'no_heartbeat_within_window',
    })
  })
})

describe('verifyStep（再起動後の1ステップ）', () => {
  const min = OTA_DEFAULTS.MIN_STABLE_MS
  function pendingState(): OtaState {
    let s = beginUpdate(freshState('sha0'), 'sha1', LATER)
    s = enterPendingVerify(s, LATER)
    return s
  }
  it('pending_verify 無し → noop', () => {
    const r = verifyStep(freshState('sha0'), { heartbeatReached: true, stableMs: min, minStableMs: min }, LATER)
    expect(r.action).toBe('noop')
  })
  it('健全 → promote（known-good=新版）', () => {
    const r = verifyStep(pendingState(), { heartbeatReached: true, stableMs: min, minStableMs: min }, LATER)
    expect(r.action).toBe('promote')
    expect(r.state.known_good_version).toBe('sha1')
    expect(r.state.status).toBe('healthy')
  })
  it('不健全 → rollback（known-good へ復帰・失敗版記録）', () => {
    const r = verifyStep(pendingState(), { heartbeatReached: false, stableMs: min, minStableMs: min }, LATER)
    expect(r.action).toBe('rollback')
    expect(r.state.running_version).toBe('sha0')
    expect(r.state.last_failed_version).toBe('sha1')
    expect(r.state.status).toBe('rolled_back')
  })
  it('未確定 → wait（状態を変えない）', () => {
    const before = pendingState()
    const r = verifyStep(before, { heartbeatReached: false, stableMs: 0, minStableMs: min }, LATER)
    expect(r.action).toBe('wait')
    expect(r.state).toEqual(before)
  })
})

describe('シナリオ: 悪い版 → ロールバック → 別の良い版で復帰', () => {
  const min = OTA_DEFAULTS.MIN_STABLE_MS
  it('一連の遷移が破綻しない', () => {
    // 1) sha0 で安定
    let s = freshState('sha0')
    // 2) desired=sha-bad → 更新開始
    expect(shouldUpdateAgent(s.running_version, 'sha-bad', s).update).toBe(true)
    s = beginUpdate(s, 'sha-bad', LATER)
    s = enterPendingVerify(s, LATER)
    // 3) 不健全 → rollback
    let step = verifyStep(s, { heartbeatReached: false, stableMs: min, minStableMs: min }, LATER)
    s = step.state
    expect(s.running_version).toBe('sha0')
    expect(s.status).toBe('rolled_back')
    // 4) 同じ sha-bad が desired のままなら再突入しない
    expect(shouldUpdateAgent(s.running_version, 'sha-bad', s).update).toBe(false)
    // 5) desired を sha-good に変更 → 更新する
    expect(shouldUpdateAgent(s.running_version, 'sha-good', s).update).toBe(true)
    s = beginUpdate(s, 'sha-good', LATER)
    s = enterPendingVerify(s, LATER)
    // 6) 健全 → promote
    step = verifyStep(s, { heartbeatReached: true, stableMs: min, minStableMs: min }, LATER)
    s = step.state
    expect(s).toMatchObject({
      running_version: 'sha-good',
      known_good_version: 'sha-good',
      last_failed_version: null,
      status: 'healthy',
    })
  })
})
