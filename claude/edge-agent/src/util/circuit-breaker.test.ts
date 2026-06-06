/**
 * F49.D: CircuitBreaker unit tests
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker'

describe('CircuitBreaker', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('CLOSED 状態では fn を実行する', async () => {
    const cb = new CircuitBreaker()
    const result = await cb.exec('store-1', async () => 42)
    expect(result).toBe(42)
    expect(cb.getState('store-1')).toBe('closed')
  })

  it('failureThreshold 回失敗で OPEN に遷移', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 })
    for (let i = 0; i < 3; i++) {
      try { await cb.exec('store-1', async () => { throw new Error('boom') }) }
      catch { /* expected */ }
    }
    expect(cb.getState('store-1')).toBe('open')
  })

  it('OPEN 状態では fn を呼ばずに CircuitOpenError', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 })
    try { await cb.exec('store-1', async () => { throw new Error('x') }) } catch { /* expected */ }
    expect(cb.getState('store-1')).toBe('open')

    const fn = vi.fn().mockResolvedValue('ok')
    await expect(cb.exec('store-1', fn)).rejects.toBeInstanceOf(CircuitOpenError)
    expect(fn).not.toHaveBeenCalled()
  })

  it('cooldown 経過後に HALF_OPEN へ自動遷移', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 })
    try { await cb.exec('store-1', async () => { throw new Error('x') }) } catch { /* expected */ }
    expect(cb.getState('store-1')).toBe('open')

    vi.advanceTimersByTime(1001)
    expect(cb.getState('store-1')).toBe('half_open')
  })

  it('HALF_OPEN で連続成功 successThreshold 回で CLOSED 復帰', async () => {
    const cb = new CircuitBreaker({
      failureThreshold: 1, cooldownMs: 1000, successThreshold: 2,
    })
    try { await cb.exec('s', async () => { throw new Error('x') }) } catch { /* expected */ }
    vi.advanceTimersByTime(1001)
    expect(cb.getState('s')).toBe('half_open')

    await cb.exec('s', async () => 1)
    expect(cb.getState('s')).toBe('half_open')   // まだ 1 回
    await cb.exec('s', async () => 1)
    expect(cb.getState('s')).toBe('closed')      // 2 回成功で復帰
  })

  it('HALF_OPEN で失敗するとすぐに OPEN へ戻る', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000 })
    try { await cb.exec('s', async () => { throw new Error('x') }) } catch { /* expected */ }
    vi.advanceTimersByTime(1001)
    expect(cb.getState('s')).toBe('half_open')

    try { await cb.exec('s', async () => { throw new Error('still failing') }) } catch { /* expected */ }
    expect(cb.getState('s')).toBe('open')
  })

  it('成功で failure カウントがリセットされる (CLOSED)', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 })
    for (let i = 0; i < 2; i++) {
      try { await cb.exec('s', async () => { throw new Error('x') }) } catch { /* expected */ }
    }
    await cb.exec('s', async () => 'ok')
    // ↑ 成功でリセットされたので、次に 3 回失敗するまでは CLOSED のまま
    for (let i = 0; i < 2; i++) {
      try { await cb.exec('s', async () => { throw new Error('x') }) } catch { /* expected */ }
    }
    expect(cb.getState('s')).toBe('closed')
  })

  it('複数キーは独立して管理される', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 })
    try { await cb.exec('a', async () => { throw new Error('x') }) } catch { /* expected */ }
    try { await cb.exec('a', async () => { throw new Error('x') }) } catch { /* expected */ }
    expect(cb.getState('a')).toBe('open')
    expect(cb.getState('b')).toBe('closed')
  })

  it('reset でクリーンアップ', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 })
    try { await cb.exec('s', async () => { throw new Error('x') }) } catch { /* expected */ }
    expect(cb.getState('s')).toBe('open')
    cb.reset('s')
    expect(cb.getState('s')).toBe('closed')
  })

  it('stats で全 breaker の状態が取れる', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 })
    try { await cb.exec('s1', async () => { throw new Error('e1') }) } catch { /* expected */ }
    try { await cb.exec('s2', async () => { throw new Error('e2') }) } catch { /* expected */ }
    const s = cb.stats()
    expect(s).toHaveLength(2)
    expect(s.find((x) => x.key === 's1')?.state).toBe('open')
    expect(s.find((x) => x.key === 's2')?.lastError).toBe('e2')
  })
})
