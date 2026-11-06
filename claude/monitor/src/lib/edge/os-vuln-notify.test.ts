import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  open: [] as { id: string; dedup_key: string }[],
  closed: [] as string[],
  inserted: [] as Record<string, unknown>[],
  mails: [] as { to: string[]; subject: string; html: string }[],
}))
vi.mock('@/lib/email/send', () => ({
  sendEmail: async (to: string[], subject: string, html: string) => { h.mails.push({ to, subject, html }); return { ok: true } },
}))

import { notifyOsVulnUrgent, urgentKey } from './os-vuln-notify'
import { sanitizeOsVuln } from './os-vuln'

/** alarm_events・stores・edge_devices・admin_users だけを真似る */
function fakeSvc() {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      let updating = false
      Object.assign(q, {
        select: () => q, eq: () => q,
        update: () => { updating = true; return q },
        in: async (_c: string, ids: string[]) => { if (updating) h.closed.push(...ids); return { error: null } },
        insert: (row: Record<string, unknown>) => { h.inserted.push(row); return { select: () => ({ single: async () => ({ data: { id: 'ev-1' } }) }) } },
        maybeSingle: async () => ({ data: table === 'stores' ? { name: '本店', tenant_id: 't-1' } : { name: 'edge-1' } }),
        then: (res: (v: unknown) => void) => res(table === 'alarm_events' ? { data: h.open } : table === 'admin_users' ? { data: [{ email: 'kanri@example.jp' }] } : { data: null }),
      })
      return q
    },
  } as never
}

const st = (findings: Record<string, unknown>[]) => sanitizeOsVuln({
  urgent: findings.filter((f) => f.level === 'urgent').length,
  servers: [{ node: 'node201', findings: findings.map((f) => ({ cve: 'CVE-2026-98432', package: 'kernel', fixed: '5.14.0-687.64.1.el9_8', installed: '5.14.0-687.10.1', ...f })) }],
})

beforeEach(() => { h.open = []; h.closed = []; h.inserted = []; h.mails = []; process.env.ALERT_EMAILS = 'ops@example.jp' })
afterEach(() => { delete process.env.ALERT_EMAILS })

describe('OS の緊急の知らせ（§13.2）', () => {
  const edge = { id: 'e-1', store_id: 's-1' }

  it('新しい緊急は運営とテナント管理者へ 1 回だけ知らせ、記録する', async () => {
    expect(await notifyOsVulnUrgent(fakeSvc(), edge, st([{ level: 'urgent' }]))).toBe(true)
    expect(h.mails).toHaveLength(1)
    expect(h.mails[0].to.sort()).toEqual(['kanri@example.jp', 'ops@example.jp'])
    expect(h.mails[0].html).toContain('CVE-2026-98432')
    expect(h.inserted[0]).toMatchObject({ event_type: 'os_vuln_urgent', status: 'new', source: 'nvms' })
  })

  it('同じ組み合わせが未処理で残っていれば送らない', async () => {
    const s = st([{ level: 'urgent' }])
    h.open = [{ id: 'ev-0', dedup_key: `nvms:os_vuln_urgent:${urgentKey(s)}` }]
    expect(await notifyOsVulnUrgent(fakeSvc(), edge, s)).toBe(false)
    expect(h.mails).toHaveLength(0)
    expect(h.closed).toHaveLength(0)
  })

  it('緊急が消えたら記録を閉じ、送らない', async () => {
    h.open = [{ id: 'ev-0', dedup_key: 'nvms:os_vuln_urgent:old' }]
    expect(await notifyOsVulnUrgent(fakeSvc(), edge, st([]))).toBe(false)
    expect(h.closed).toEqual(['ev-0'])
    expect(h.mails).toHaveLength(0)
  })

  it('再起動だけで直るもの・定期保守は知らせない', async () => {
    expect(urgentKey(st([{ level: 'urgent', needs_reboot: true }]))).toBeNull()
    expect(urgentKey(st([{ level: 'routine' }]))).toBeNull()
    expect(await notifyOsVulnUrgent(fakeSvc(), edge, st([{ level: 'routine' }]))).toBe(false)
  })
})
