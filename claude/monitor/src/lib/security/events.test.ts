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
