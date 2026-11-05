import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * CSV 一括投入の受け口 (/api/admin/import/stores・/cameras) をテナント管理者以上に絞る (2026-11-05)。
 *
 * 以前は requireAdmin (拠点管理者を含む) で、画面の「CSV 一括投入」のボタンを
 * role-menu.ts の isTenantAdminOrSuper で隠しただけだった。拠点管理者が受け口を直接呼ぶと
 * 通っていたので、**サーバ側で** 403 になることを固定する。ガードは本物を使い、
 * DB の接続 (誰がどの役割か) だけを差し替える。
 */

const h = vi.hoisted(() => ({
  role: null as string | null,
  heavyCalls: 0,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: h.role ? { id: 'u1' } : null } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: h.role ? { id: 'a1', role: h.role, tenant_id: 't1', store_ids: ['s1'] } : null }),
        }),
      }),
    }),
  }),
  createSupabaseService: () => ({}),
}))
vi.mock('@/lib/security/events', () => ({ logSecurityEvent: () => {}, requestIp: () => null }))
vi.mock('@/lib/tenant/acting', () => ({ resolveAdminContext: async () => ({ tenantId: 't1' }) }))
// ガードを通った先は回数の上限で止める (通ったかどうかだけを見る)
vi.mock('@/lib/limits/heavy', () => ({
  heavyAllows: async () => { h.heavyCalls++; return { ok: false, retryAfterSec: 1 } },
  tooManyRequests: () => new Response(null, { status: 429 }),
}))
vi.mock('@/lib/admin/audit', () => ({ recordAudit: async () => {} }))

import { POST as postStores } from './stores/route'
import { POST as postCameras } from './cameras/route'

const req = () => new NextRequest('http://localhost/api/admin/import/x', { method: 'POST', body: 'name\nA店' })

beforeEach(() => {
  h.role = null
  h.heavyCalls = 0
})

describe.each([
  ['stores', postStores],
  ['cameras', postCameras],
])('POST /api/admin/import/%s', (_name, post) => {
  it('★拠点管理者 (store_manager) は 403 で、先へ進まない', async () => {
    h.role = 'store_manager'
    const res = await post(req())
    expect(res.status).toBe(403)
    expect(h.heavyCalls).toBe(0)
  })

  it('閲覧者・手荷物検査店長も 403', async () => {
    for (const r of ['viewer', 'baggage_manager']) {
      h.role = r
      expect((await post(req())).status).toBe(403)
    }
    expect(h.heavyCalls).toBe(0)
  })

  it('未ログインは 401', async () => {
    expect((await post(req())).status).toBe(401)
  })

  it('テナント管理者・全体管理者はガードを通る', async () => {
    for (const r of ['tenant_admin', 'super_admin']) {
      h.role = r
      expect((await post(req())).status).toBe(429)
    }
    expect(h.heavyCalls).toBe(2)
  })
})
