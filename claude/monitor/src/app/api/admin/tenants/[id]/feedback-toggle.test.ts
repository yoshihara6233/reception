import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/test/fake-supabase'

/**
 * テナントの「要望の受付」の切り替え（PUT /api/admin/tenants/[id] の feedback_enabled・
 * 基本設計 §3.1・GVMS_CLOUD_SPEC §12.1）。
 *   - 切り替えられるのは運営（super_admin）だけ（テナント管理者は 403・値は変わらない）
 *   - 値が変わったときだけ、運営アクセスログに tenant.feedback_enabled（前後の値）を残す
 *   - 使われ方の集計（usage_enabled）は第 2 段なので、送られても書かない
 */

const h = vi.hoisted(() => ({
  guard: null as unknown,
  db: null as unknown as ReturnType<typeof createFakeDb>,
  audits: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/admin/guard', () => ({ requireAdmin: async () => h.guard }))
vi.mock('@/lib/admin/audit', () => ({
  recordAudit: async (_supa: unknown, e: Record<string, unknown>) => { h.audits.push(e) },
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseService: () => h.db.client }))

import { PUT } from './route'

const superGuard = {
  ok: true,
  user: { id: 'actor' },
  profile: { id: 'p1', role: 'super_admin', tenant_id: 'home', store_ids: [] },
  supa: {},
}

function put(body: unknown) {
  const req = new NextRequest('http://localhost/api/admin/tenants/t1', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  return PUT(req, { params: Promise.resolve({ id: 't1' }) })
}

beforeEach(() => {
  h.guard = superGuard
  h.db = createFakeDb({ tenants: [{ id: 't1', name: 'テナントA', feedback_enabled: true, usage_enabled: true }] })
  h.audits = []
})

describe('PUT /api/admin/tenants/[id] — 要望の受付', () => {
  it('★運営が止めると feedback_enabled=false になり、前後の値を運営アクセスログに残す', async () => {
    const res = await put({ name: 'テナントA', feedback_enabled: false })
    expect(res.status).toBe(200)
    expect(h.db.rows('tenants')[0].feedback_enabled).toBe(false)
    const toggle = h.audits.filter((a) => a.action === 'tenant.feedback_enabled')
    expect(toggle).toEqual([
      expect.objectContaining({ targetType: 'tenant', targetId: 't1', actorUserId: 'actor', changes: { before: true, after: false } }),
    ])
    // いつもの tenant.update も残る
    expect(h.audits.map((a) => a.action)).toContain('tenant.update')
  })

  it('★再開も同じく記録する', async () => {
    h.db.rows('tenants')[0].feedback_enabled = false
    await put({ feedback_enabled: true })
    expect(h.db.rows('tenants')[0].feedback_enabled).toBe(true)
    expect(h.audits.find((a) => a.action === 'tenant.feedback_enabled')?.changes).toEqual({ before: false, after: true })
  })

  it('値が変わらない保存（フォームの他の項目だけ変えた）では切り替えの記録を残さない', async () => {
    await put({ name: '新しい名前', feedback_enabled: true })
    expect(h.audits.map((a) => a.action)).toEqual(['tenant.update'])
  })

  it('★テナント管理者は切り替えられない（403・値は変わらない）', async () => {
    h.guard = { ...superGuard, profile: { ...superGuard.profile, role: 'tenant_admin', tenant_id: 't1' } }
    const res = await put({ feedback_enabled: false })
    expect(res.status).toBe(403)
    expect(h.db.rows('tenants')[0].feedback_enabled).toBe(true)
    expect(h.audits).toEqual([])
  })

  it('使われ方の集計（usage_enabled）は第 2 段なので書かない', async () => {
    const res = await put({ usage_enabled: false, feedback_enabled: true })
    expect(res.status).toBe(200)
    expect(h.db.rows('tenants')[0].usage_enabled).toBe(true)
  })

  it('真偽値でなければ 400', async () => {
    const res = await put({ feedback_enabled: 'no' })
    expect(res.status).toBe(400)
    expect(h.db.rows('tenants')[0].feedback_enabled).toBe(true)
  })

  it('無いテナントは 404', async () => {
    h.db = createFakeDb({ tenants: [] })
    const res = await put({ feedback_enabled: false })
    expect(res.status).toBe(404)
  })
})
