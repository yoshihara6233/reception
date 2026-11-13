import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/test/fake-supabase'

/**
 * 役割だけを確かめて service role で引いていた、小さい 4 か所（2026-11-13・見直しの続き）。
 *
 *   ★計測の記録: 見えない拠点・カメラの ID では書けない。大きすぎる meta は捨てる
 *   ★ライセンスの失効: 拠点管理者は、担当外の拠点（エッジが見えない）のライセンスを失効できない
 *   ★拠点の更新: 他テナントの拠点は 404（契約の有無を答えない・成功と監査の記録に進まない）
 *   ★拠点の CSV 一括投入: 運営のほかは、CSV の tenant_id で他テナントを指せない
 *
 * 偽の DB に RLS は無いので、「利用者の権限で見える行」だけを持つ DB（userDb）と、
 * 全部の行を持つ DB（svcDb = service role）の 2 つを用意して見分ける。
 */

const STORE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const STORE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const CAM_A   = 'aaaaaaaa-0000-4aaa-8aaa-aaaaaaaaaaaa'
const CAM_B   = 'bbbbbbbb-0000-4bbb-8bbb-bbbbbbbbbbbb'

const h = vi.hoisted(() => ({
  userDb: null as unknown as ReturnType<typeof import('@/test/fake-supabase').createFakeDb>,
  svcDb:  null as unknown as ReturnType<typeof import('@/test/fake-supabase').createFakeDb>,
  role: 'tenant_admin',
  quotaTenants: [] as string[],
  audits: [] as string[],
}))
const userClient = () => ({ ...h.userDb.client, auth: { getUser: async () => ({ data: { user: { id: 'u-a' } } }) } })
const guardOk = async () => ({
  ok: true as const, user: { id: 'u-a' },
  profile: { id: 'p-a', role: h.role, tenant_id: 't-a', store_ids: [STORE_A] },
  supa: userClient(),
})
vi.mock('@/lib/admin/guard', () => ({ requireAdmin: () => guardOk(), requireTenantAdminOrSuper: () => guardOk() }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => userClient(),
  createSupabaseService: () => h.svcDb.client,
}))
vi.mock('@/lib/tenant/acting', () => ({ resolveAdminContext: async () => ({ tenantId: 't-a' }) }))
vi.mock('@/lib/limits/heavy', () => ({
  heavyAllows: async () => ({ ok: true }),
  tooManyRequests: () => new Response(null, { status: 429 }),
}))
vi.mock('@/lib/admin/audit', () => ({
  recordAudit: async (_s: unknown, e: { action: string }) => { h.audits.push(e.action) },
  storeIdForEdge: async () => null,
}))
vi.mock('@/lib/admin/tenant-quota', async (orig) => {
  const real = await orig<typeof import('@/lib/admin/tenant-quota')>()
  return {
    ...real,
    getTenantQuota: async (_s: unknown, tid: string) => {
      h.quotaTenants.push(tid)
      return {
        limits: { stores: null, patrol: null, alarm: null, baggage: null },
        contract: { patrol: false, alarm: false, baggage: false },
      }
    },
    getStoreCount: async () => 0,
    getOptionOnCount: async () => 0,
  }
})

import { POST as postMetric } from '@/app/api/metrics/route'
import { DELETE as revokeLicense } from '@/app/api/admin/licenses/[id]/route'
import { PUT as putStore } from '@/app/api/admin/stores/[id]/route'
import { POST as importStores } from '@/app/api/admin/import/stores/route'

function seed() {
  h.role = 'tenant_admin'
  h.quotaTenants = []
  h.audits = []
  const storeA = { id: STORE_A, tenant_id: 't-a', name: '自社の拠点', opt_patrol: false, opt_alarm: false, opt_baggage: false }
  const storeB = { id: STORE_B, tenant_id: 't-b', name: '他社の拠点', opt_patrol: false, opt_alarm: false, opt_baggage: false }
  h.userDb = createFakeDb({
    stores: [storeA],
    recorder_cameras: [{ id: CAM_A }],
    edge_devices: [{ id: 'e-a', store_id: STORE_A }],
    // licenses の読み取りの決まりはテナントまで: 同じテナントの担当外の拠点 (e-a2) の分も見える
    licenses: [{ id: 'l-a', edge_id: 'e-a', status: 'active' }, { id: 'l-a2', edge_id: 'e-a2', status: 'active' }],
  })
  h.svcDb = createFakeDb({
    stores: [storeA, storeB],
    recorder_cameras: [{ id: CAM_A }, { id: CAM_B }],
    edge_devices: [{ id: 'e-a', store_id: STORE_A }, { id: 'e-a2', store_id: 'other-store-same-tenant' }],
    licenses: [{ id: 'l-a', edge_id: 'e-a', status: 'active' }, { id: 'l-a2', edge_id: 'e-a2', status: 'active' }],
    metric_events: [],
  })
}
const svcRows = (t: string) => h.svcDb.tables[t] as Record<string, unknown>[]
const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('計測の記録 (/api/metrics)', () => {
  beforeEach(seed)
  const post = (b: unknown) => postMetric(json('http://localhost/api/metrics', 'POST', b))

  it('見えない拠点の ID では書けない', async () => {
    expect((await post({ kind: 'ttff_ms', storeId: STORE_B, value: 1 })).status).toBe(404)
    expect(svcRows('metric_events')).toHaveLength(0)
  })
  it('見えないカメラの ID・形の違う ID では書けない', async () => {
    expect((await post({ kind: 'ttff_ms', storeId: STORE_A, cameraId: CAM_B })).status).toBe(404)
    expect((await post({ kind: 'ttff_ms', storeId: 'x' })).status).toBe(404)
    expect(svcRows('metric_events')).toHaveLength(0)
  })
  it('見える拠点とカメラは書ける。拠点なしも書ける', async () => {
    expect((await post({ kind: 'ttff_ms', storeId: STORE_A, cameraId: CAM_A, value: 120 })).status).toBe(200)
    expect((await post({ kind: 'live_error' })).status).toBe(200)
    expect(svcRows('metric_events')).toHaveLength(2)
    expect(svcRows('metric_events')[0].user_id).toBe('u-a')
  })
  it('大きすぎる meta は捨てる', async () => {
    expect((await post({ kind: 'ttff_ms', meta: { a: 'x'.repeat(5000) } })).status).toBe(200)
    expect(svcRows('metric_events')[0].meta).toBeNull()
  })
})

describe('ライセンスの失効 (/api/admin/licenses/[id])', () => {
  beforeEach(() => { seed(); h.role = 'store_manager' })
  const del = (id: string) => revokeLicense(new NextRequest(`http://localhost/api/admin/licenses/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  })

  it('担当外の拠点 (エッジが見えない) のライセンスは失効できない', async () => {
    expect((await del('l-a2')).status).toBe(404)
    expect(svcRows('licenses').find((l) => l.id === 'l-a2')?.status).toBe('active')
    expect(h.audits).toHaveLength(0)
  })
  it('担当の拠点のライセンスは失効できる', async () => {
    expect((await del('l-a')).status).toBe(200)
    expect(svcRows('licenses').find((l) => l.id === 'l-a')?.status).toBe('revoked')
  })
})

describe('拠点の更新 (/api/admin/stores/[id])', () => {
  beforeEach(seed)
  const put = (id: string, b: unknown) => putStore(json(`http://localhost/api/admin/stores/${id}`, 'PUT', b), {
    params: Promise.resolve({ id }),
  })

  it('他テナントの拠点のオプションを変えようとしても、契約の有無を答えない', async () => {
    const res = await put(STORE_B, { opt_alarm: true })
    expect(res.status).toBe(404)
    expect(h.quotaTenants).toHaveLength(0)
  })
  it('届かない拠点の更新は 404 で、監査の記録に進まない', async () => {
    const res = await put(STORE_B, { name: '書き換え' })
    expect(res.status).toBe(404)
    expect(h.audits).toHaveLength(0)
    expect(svcRows('stores').find((s) => s.id === STORE_B)?.name).toBe('他社の拠点')
  })
  it('自分の拠点は更新できる', async () => {
    const res = await put(STORE_A, { name: '新しい名前' })
    expect(res.status).toBe(200)
    expect(h.audits).toEqual(['store.update'])
  })
})

describe('拠点の CSV 一括投入 (/api/admin/import/stores)', () => {
  beforeEach(seed)
  const imp = (csv: string) => importStores(new NextRequest('http://localhost/api/admin/import/stores', { method: 'POST', body: csv }))

  it('テナント管理者は、CSV の tenant_id で他テナントを指せない', async () => {
    const res = await imp('name,tenant_id,opt_alarm\n他社の拠点,t-b,true\n')
    const body = await res.json()
    expect(body.results[0]).toMatchObject({ ok: false, error: 'tenant_not_allowed' })
    // 他テナントの契約も拠点名も引いていない
    expect(h.quotaTenants).not.toContain('t-b')
    expect(h.svcDb.calls.filter((c) => c.table === 'stores')).toHaveLength(0)
  })
  it('自分のテナントを書いた行・空の行は通る', async () => {
    const res = await imp('name,tenant_id\n新店 1,t-a\n新店 2,\n')
    const body = await res.json()
    expect(body.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, true])
  })
  it('運営は、CSV の tenant_id でテナントを指せる', async () => {
    h.role = 'super_admin'
    const res = await imp('name,tenant_id\n他社の新店,t-b\n')
    const body = await res.json()
    expect(body.results[0].error).not.toBe('tenant_not_allowed')
    expect(h.quotaTenants).toContain('t-b')
  })
})
