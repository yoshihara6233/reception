import { afterEach, describe, expect, it, vi } from 'vitest'
import { logSecurityEvent, requestIp } from './events'

afterEach(() => { vi.restoreAllMocks() })

describe('安全に関わる出来事の記録 (ASVS 16.3)', () => {
  it('1 件を [security] の付いた 1 行の JSON にする', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    logSecurityEvent({ kind: 'authz.denied', actor: 'u-1', status: 403, detail: { role: 'viewer' } })
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0][0])
    expect(line.startsWith('[security] ')).toBe(true)
    expect(JSON.parse(line.slice('[security] '.length))).toMatchObject({ kind: 'authz.denied', actor: 'u-1', status: 403, detail: { role: 'viewer' } })
  })
  it('接続元は x-forwarded-for の先頭', () => {
    expect(requestIp(new Headers({ 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }))).toBe('203.0.113.5')
    expect(requestIp(new Headers())).toBeNull()
  })
})

describe('記録の間引き (ASVS 16.3.3)', () => {
  it('同じ種類・道・接続元は 60 秒に 1 行・捨てた件数を次の行に載せる', async () => {
    const { logSecurityEventThrottled, resetSecurityEventThrottle, THROTTLE_WINDOW_MS } = await import('./events')
    resetSecurityEventThrottle()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const e = { kind: 'input.invalid' as const, path: '/api/x', ip: '203.0.113.5' }
    expect(logSecurityEventThrottled(e, 1_000)).toBe(true)
    expect(logSecurityEventThrottled(e, 2_000)).toBe(false)
    expect(logSecurityEventThrottled(e, 3_000)).toBe(false)
    // 別の接続元は別に数える
    expect(logSecurityEventThrottled({ ...e, ip: '203.0.113.6' }, 3_000)).toBe(true)
    expect(logSecurityEventThrottled(e, 1_000 + THROTTLE_WINDOW_MS)).toBe(true)
    expect(warn).toHaveBeenCalledTimes(3)
    const last = JSON.parse(String(warn.mock.calls[2][0]).slice('[security] '.length))
    expect(last.detail).toEqual({ suppressed: 2 })
  })
})
