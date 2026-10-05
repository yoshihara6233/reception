import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/test/fake-supabase'

/**
 * クラウドの画面の受け口 /api/feedback（基本設計 §3.1: 送れるのはテナント管理者だけ）。
 *
 * ガードは本物（requireTenantAdmin）を通す。偽物にするのはセッションの利用者と DB だけ。
 * ★の試験は「テナント管理者以外は送れない・読めない」「断ったときに service role へ届かない」。
 */

const h = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as { id: string; role: string; tenant_id: string | null; store_ids: string[] } | null,
  db: null as unknown as ReturnType<typeof import('@/test/fake-supabase').createFakeDb>,
  serviceCalls: 0,
  notified: 0,
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: (table: string) => {
      if (table === 'admin_users') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: h.profile }) }) }) }
      }
      // RLS 配下の読み取り（一覧）は偽の DB をそのまま使う（RLS はマイグレーション側で確かめる）
      return h.db.client.from(table)
    },
  }),
  createSupabaseService: () => { h.serviceCalls += 1; return h.db.client },
}))
vi.mock('@/lib/feedback/notify', () => ({ notifyBlockingFeedback: async () => { h.notified += 1 } }))

import { GET, POST } from './route'

const TENANT = 'tenant-1'
const post = (b: unknown) => POST(new NextRequest('http://localhost/api/feedback', {
  method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' },
}))
const valid = {
  kind: 'bug', urgency: 'inconvenient', body: '拠点の一覧が遅い', contact_ok: false,
  context: { screen: '/stores/[id]', browser: 'chrome/141', os: 'macos', viewport: '1440x900', secret: 'x' },
}

function as(role: string | null, tenantId: string | null = TENANT) {
  h.user = role ? { id: `user-${role}` } : null
  h.profile = role ? { id: `p-${role}`, role, tenant_id: tenantId, store_ids: [] } : null
}

function seed(enabled = true, items: Record<string, unknown>[] = []) {
  h.db = createFakeDb({
    tenants: [{ id: TENANT, name: 'テナントA', feedback_enabled: enabled }],
    feedback_items: items,
  }, {
    defaults: { feedback_items: () => ({ status: 'received', created_at: new Date().toISOString() }) },
  })
}

beforeEach(() => {
  as('tenant_admin')
  seed()
  h.serviceCalls = 0
  h.notified = 0
})

describe('POST /api/feedback — 送れるのはテナント管理者だけ', () => {
  it('テナント管理者は 201・source=cloud・送った人の id を残す', async () => {
    const res = await post(valid)
    expect(res.status).toBe(201)
    const row = h.db.rows('feedback_items')[0]
    expect(row).toMatchObject({
      tenant_id: TENANT, store_id: null, edge_id: null, source: 'cloud', submitted_by: 'user-tenant_admin', role: 'tenant_admin',
      kind: 'bug', urgency: 'inconvenient',
    })
    // 自動で添える項目は既知のものだけ
    expect(row.context).toEqual({ screen: '/stores/[id]', browser: 'chrome/141', os: 'macos', viewport: '1440x900' })
  })

  it.each(['super_admin', 'store_manager', 'viewer', 'baggage_manager'])('★%s は 403 で、service role に届かない', async (role) => {
    as(role)
    const res = await post(valid)
    expect(res.status).toBe(403)
    expect(h.serviceCalls).toBe(0)
    expect(h.db.rows('feedback_items')).toHaveLength(0)
  })

  it('★未ログインは 401', async () => {
    as(null)
    expect((await post(valid)).status).toBe(401)
    expect(h.serviceCalls).toBe(0)
  })

  it('テナントに属さない tenant_admin（壊れたデータ）は 403', async () => {
    as('tenant_admin', null)
    expect((await post(valid)).status).toBe(403)
  })

  it('★テナントが止めていれば 409', async () => {
    seed(false)
    const res = await post(valid)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('feedback_disabled')
  })

  it('★1 人 1 日 20 件を超えたら 429', async () => {
    const now = new Date().toISOString()
    seed(true, Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, submitted_by: 'user-tenant_admin', created_at: now })))
    expect((await post(valid)).status).toBe(429)
  })

  it('本文の連絡先は伏せ字にして保存する', async () => {
    await post({ ...valid, body: '折り返しは 03-1234-5678 か a@b.co.jp へ' })
    const saved = String(h.db.rows('feedback_items')[0].body)
    expect(saved).not.toMatch(/03-1234|a@b/)
  })

  it('形の誤りは 400', async () => {
    expect((await post({ ...valid, kind: 'x' })).status).toBe(400)
    expect((await post({ ...valid, body: '' })).status).toBe(400)
  })

  it('業務が止まるは運営へすぐ知らせる', async () => {
    await post({ ...valid, urgency: 'blocking' })
    expect(h.notified).toBe(1)
  })
})

describe('GET /api/feedback — 一覧もテナント管理者だけ', () => {
  it('テナント管理者は自分のテナントの要望だけ', async () => {
    seed(true, [
      { id: 'mine', tenant_id: TENANT, created_at: '2026-10-06T00:00:00Z' },
      { id: 'other', tenant_id: 'tenant-2', created_at: '2026-10-06T00:00:00Z' },
    ])
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).items.map((i: { id: string }) => i.id)).toEqual(['mine'])
  })

  it.each(['super_admin', 'store_manager', 'viewer'])('★%s は 403', async (role) => {
    as(role)
    expect((await GET()).status).toBe(403)
  })
})
