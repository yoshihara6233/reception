import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  user: { id: 'u-1' } as { id: string } | null,
  role: 'tenant_admin' as string | null,
  consented: false,
  inserts: [] as Record<string, unknown>[],
  refreshed: 0,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: {
      getUser: async () => ({ data: { user: h.user } }),
      getSession: async () => ({ data: { session: { access_token: 'x.e30.y' } } }),
      refreshSession: async () => { h.refreshed++; return {} },
    },
    rpc: async (name: string) => ({ data: name === 'auth_user_role' ? h.role : name === 'auth_user_tenant_id' ? 't-1' : null }),
  }),
  createSupabaseService: () => ({
    from: () => {
      const q = {
        select: () => q, eq: () => q,
        limit: async () => ({ data: h.consented ? [{ id: 1 }] : [] }),
        insert: async (row: Record<string, unknown>) => { h.inserts.push(row); h.consented = true; return { error: null } },
      }
      return q
    },
  }),
}))

import { GET, POST } from './route'

const post = (body: unknown) => POST(new NextRequest('https://monitor.test/api/auth/terms', {
  method: 'POST', body: JSON.stringify(body),
  headers: { 'content-type': 'application/json', origin: 'https://monitor.test', 'sec-fetch-site': 'same-origin', 'x-forwarded-for': '203.0.113.5', 'user-agent': 'UA' },
}))

beforeEach(() => {
  process.env.TERMS_VERSION = '2026-11-24'
  h.user = { id: 'u-1' }; h.role = 'tenant_admin'; h.consented = false; h.inserts = []; h.refreshed = 0
})
afterEach(() => { delete process.env.TERMS_VERSION })

describe('/api/auth/terms（G-9）', () => {
  it('同意していないテナント管理者には required と版・掲載先を返す', async () => {
    const res = await GET()
    expect(await res.json()).toMatchObject({ required: true, version: '2026-11-24', url: 'https://g-vms.com/terms' })
  })

  it('同意を記録し、セッションを新しくする（押し直しは記録を増やさない）', async () => {
    expect((await post({ version: '2026-11-24' })).status).toBe(200)
    expect(h.inserts).toHaveLength(1)
    expect(h.inserts[0]).toMatchObject({ terms_version: '2026-11-24', user_id: 'u-1', tenant_id: 't-1', ip: '203.0.113.5', user_agent: 'UA' })
    expect(h.refreshed).toBe(1)
    expect((await post({ version: '2026-11-24' })).status).toBe(200)
    expect(h.inserts).toHaveLength(1)
    expect((await (await GET()).json()).required).toBe(false)
  })

  it('画面に出した版と違えば 409・施行の前も 409', async () => {
    expect((await post({ version: '2025-01-01' })).status).toBe(409)
    delete process.env.TERMS_VERSION
    expect((await post({ version: '2026-11-24' })).status).toBe(409)
    expect(h.inserts).toHaveLength(0)
  })

  it('テナント管理者でなければ求めず、記録もしない', async () => {
    h.role = 'super_admin'
    expect((await (await GET()).json()).required).toBe(false)
    expect((await post({ version: '2026-11-24' })).status).toBe(200)
    expect(h.inserts).toHaveLength(0)
  })

  it('ログインしていなければ 401', async () => {
    h.user = null
    expect((await GET()).status).toBe(401)
    expect((await post({ version: '2026-11-24' })).status).toBe(401)
  })
})
