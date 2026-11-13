import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 試作のエッジ箱 (kind=edge) の登録コードは、運営 (super_admin) だけが発行できる (2026-11-13)。
 *
 * 以前は tenant_admin・store_manager も発行でき、enroll → bootstrap と呼ぶと service_role を
 * 受け取れた。bootstrap は鍵を返さなくなったが、入口も閉じておく (守りを 1 枚にしない)。
 * 画面 (/admin/edges/new) はもともと super_admin 専用で、API だけが広かった。
 * テナントの管理者が使う G・VMS の拠点 (kind=nvms) は、今までどおり発行できること。
 */

const h = vi.hoisted(() => ({
  role: 'tenant_admin' as string,
  inserts: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/admin/guard', () => ({
  requireAdmin: async () => ({
    ok: true as const,
    user: { id: 'user-1' },
    profile: { id: 'admin-1', role: h.role, tenant_id: 'tenant-1', store_ids: [] },
    supa: {
      from: () => {
        const q = { select: () => q, eq: () => q, single: async () => ({ data: { id: 'store-1', tenant_id: 'tenant-1' }, error: null }) }
        return q
      },
    },
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseService: () => ({
    from: () => {
      const q = {
        insert: (row: Record<string, unknown>) => { h.inserts.push(row); return q },
        select: () => q,
        single: async () => ({ data: { id: 'enr-1', expires_at: '2026-11-14T00:00:00Z' }, error: null }),
      }
      return q
    },
  }),
}))

vi.mock('@/lib/admin/audit', () => ({ recordAudit: async () => {} }))

const STORE = '11111111-1111-4111-8111-111111111111'
const post = async (body: Record<string, unknown>) => {
  const { POST } = await import('@/app/api/admin/enrollments/route')
  const { NextRequest } = await import('next/server')
  const res = await POST(new NextRequest('http://localhost/api/admin/enrollments', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
  return { status: res.status, json: await res.json() as Record<string, unknown> }
}

beforeEach(() => { h.role = 'tenant_admin'; h.inserts = [] })

describe('/api/admin/enrollments — 試作のエッジ箱の登録コードは運営だけ', () => {
  it.each(['tenant_admin', 'store_manager'])('★%s は kind=edge を発行できない (403・何も作らない)', async (role) => {
    h.role = role
    const r = await post({ store_id: STORE, name: '箱', kind: 'edge' })
    expect(r.status).toBe(403)
    expect(h.inserts).toHaveLength(0)
  })

  it('★kind を省くと既定は edge なので、同じく断る', async () => {
    const r = await post({ store_id: STORE, name: '箱' })
    expect(r.status).toBe(403)
    expect(h.inserts).toHaveLength(0)
  })

  it('tenant_admin は G・VMS の拠点 (kind=nvms) を今までどおり発行できる', async () => {
    const r = await post({ store_id: STORE, name: 'G・VMS', kind: 'nvms' })
    expect(r.status).toBe(200)
    expect(h.inserts[0]?.kind).toBe('nvms')
  })

  it('super_admin は kind=edge を発行できる', async () => {
    h.role = 'super_admin'
    const r = await post({ store_id: STORE, name: '箱', kind: 'edge' })
    expect(r.status).toBe(200)
    expect(h.inserts[0]?.kind).toBe('edge')
  })
})
