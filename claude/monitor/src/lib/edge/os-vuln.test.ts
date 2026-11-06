import { describe, expect, it } from 'vitest'
import { MAX_OS_VULN_FINDINGS, MAX_OS_VULN_SERVERS, osVulnState, sanitizeOsVuln } from './os-vuln'

const finding = (o: Record<string, unknown> = {}) => ({
  id: 'GVMS-SA-2026-001', cve: 'CVE-2026-98432', package: 'kernel', level: 'urgent',
  fixed: '5.14.0-687.64.1.el9_8', installed: '5.14.0-687.10.1.el9_8.0.1', ...o,
})

describe('sanitizeOsVuln（§13）', () => {
  it('決めた項目だけを写す', () => {
    const st = sanitizeOsVuln({
      table_version: 1, urgent: 1, routine: 0, extra: 'x',
      servers: [{ node: 'node201', kernel: '5.14.0-687.10.1.el9_8.0.1', table_version: 1, urgent: 1, routine: 0, deferred: 0,
        checked_at: '2026-11-06T14:20:09+09:00', secret: 'y', findings: [finding({ bogus: 1 })] }],
    })
    expect(st).toEqual({
      table_version: 1, urgent: 1, routine: 0,
      servers: [{ node: 'node201', kernel: '5.14.0-687.10.1.el9_8.0.1', table_version: 1, urgent: 1, routine: 0, deferred: 0,
        checked_at: '2026-11-06T14:20:09+09:00', findings: [finding()] }],
    })
  })

  it('★形が崩れていても投げずに、読めた分だけ使う', () => {
    expect(sanitizeOsVuln('x')).toBeNull()
    expect(sanitizeOsVuln([1])).toBeNull()
    const st = sanitizeOsVuln({ urgent: -3, servers: [null, { node: '' }, { node: 'n1', findings: [{ cve: 'C' }, finding({ level: 'evil' })] }] })
    expect(st?.urgent).toBe(0)
    expect(st?.servers).toHaveLength(1)
    expect(st?.servers[0].findings).toHaveLength(1)
    expect(st?.servers[0].findings[0].level).toBe('deferred')
  })

  it('16 台・1 台 20 件で切る', () => {
    const servers = Array.from({ length: 30 }, (_, i) => ({ node: `n${i}`, findings: Array.from({ length: 40 }, () => finding()) }))
    const st = sanitizeOsVuln({ servers })!
    expect(st.servers).toHaveLength(MAX_OS_VULN_SERVERS)
    expect(st.servers[0].findings).toHaveLength(MAX_OS_VULN_FINDINGS)
  })
})

describe('osVulnState', () => {
  const st = (findings: Record<string, unknown>[], urgent: number, routine = 0) =>
    sanitizeOsVuln({ urgent, routine, servers: [{ node: 'n', findings }] })
  it('件数が無ければ none・まとめてだけでも none', () => {
    expect(osVulnState(null)).toBe('none')
    expect(osVulnState(st([finding({ level: 'deferred' })], 0))).toBe('none')
  })
  it('緊急・定期保守・再起動で直る', () => {
    expect(osVulnState(st([finding()], 1))).toBe('urgent')
    expect(osVulnState(st([finding({ level: 'routine' })], 0, 1))).toBe('routine')
    expect(osVulnState(st([finding({ needs_reboot: true })], 1))).toBe('reboot')
  })
})
