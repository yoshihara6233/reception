import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * テナント削除 (DELETE /api/admin/tenants/[id]・2026-10-05) の安全策と後始末を固定する。
 *
 * 配下ごと消えて元に戻せないので、**サーバ側で**次を確かめることを見る
 * (画面の安全策だけでは、API を直接叩かれると素通りする):
 *   - super_admin だけ
 *   - 状態が「停止 (suspended)」のテナントだけ
 *   - テナント名の打ち込みが一致したときだけ
 *   - 自分の所属テナントと、super_admin が所属するテナントは消さない
 * 消したあとは、ログイン用のアカウント (ユーザとエッジ) を消し、監査ログを残す。
 * アカウントの削除の失敗では全体を失敗にしない (DB からはもう消えている)。
 */

type Row = Record<string, unknown>
const h = vi.hoisted(() => ({
  guard: null as unknown,
  tenant: null as Row | null,
  supers: 0,
  users: [] as Row[],
  stores: [] as Row[],
  edges: [] as Row[],
  rpc: { data: null as unknown, error: null as { message: string } | null },
  failAuth: [] as string[],
  rpcCalls: [] as unknown[],
  deleted: [] as string[],
  audits: [] as Row[],
}))

vi.mock('@/lib/admin/guard', () => ({ requireAdmin: async () => h.guard }))
vi.mock('@/lib/admin/audit', () => ({
  recordAudit: async (_supa: unknown, e: Row) => { h.audits.push(e) },
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseService: () => {
    const from = (table: string) => {
      let head = false
      let sel = ''
      const result = () => {
        if (table === 'tenants') return { data: h.tenant }
        if (table === 'admin_users' && head) return { count: h.supers }
        if (table === 'admin_users') return { data: h.users }
        if (table === 'stores') return { data: h.stores }
        if (table === 'edge_devices') return { data: h.edges }
        throw new Error(`unexpected table ${table} (${sel})`)
      }
      const b = {
        select(s: string, opts?: { head?: boolean }) { sel = s; head = !!opts?.head; return b },
        eq() { return b },
        in() { return b },
        maybeSingle: async () => result(),
        then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
          return Promise.resolve().then(result).then(res, rej)
        },
      }
      return b
    }
    return {
      from,
      rpc: async (name: string, args: unknown) => { h.rpcCalls.push({ name, args }); return h.rpc },
      auth: {
        admin: {
          deleteUser: async (uid: string) => {
            h.deleted.push(uid)
            return { error: h.failAuth.includes(uid) ? { message: 'boom' } : null }
          },
        },
      },
    }
  },
}))

import { DELETE } from './route'

const superGuard = {
  ok: true,
  user: { id: 'actor' },
  profile: { id: 'p1', role: 'super_admin', tenant_id: 'home', store_ids: [] },
  supa: {},
}

function call(body: unknown, cookie?: string) {
  const req = new NextRequest('http://localhost/api/admin/tenants/t1', {
    method: 'DELETE',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  })
  return DELETE(req, { params: Promise.resolve({ id: 't1' }) })
}

beforeEach(() => {
  h.guard = superGuard
  h.tenant = { id: 't1', name: '某家電量販店様 デモ', status: 'suspended' }
  h.supers = 0
  h.users = [{ auth_user_id: 'u1' }, { auth_user_id: null }]
  h.stores = [{ id: 's1' }, { id: 's2' }]
  h.edges = [{ auth_user_id: 'e1' }, { auth_user_id: 'u1' }] // 重複は 1 回だけ消す
  h.rpc = { data: { stores: 2, edge_devices: 2, alarm_events: 3 }, error: null }
  h.failAuth = []
  h.rpcCalls = []
  h.deleted = []
  h.audits = []
})

describe('DELETE /api/admin/tenants/[id] — 安全策', () => {
  it('super_admin 以外は 403 で、何も消さない', async () => {
    h.guard = { ...superGuard, profile: { ...superGuard.profile, role: 'tenant_admin' } }
    const res = await call({ confirm_name: '某家電量販店様 デモ' })
    expect(res.status).toBe(403)
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('未ログイン・ロール不足はガードの状態をそのまま返す', async () => {
    h.guard = { ok: false, status: 401, error: 'unauthorized' }
    const res = await call({ confirm_name: '某家電量販店様 デモ' })
    expect(res.status).toBe(401)
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('★停止にしていないテナントは 409 not_suspended で、何も消さない', async () => {
    h.tenant = { ...h.tenant!, status: 'trial' }
    const res = await call({ confirm_name: '某家電量販店様 デモ' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('not_suspended')
    expect(h.rpcCalls).toHaveLength(0)
    expect(h.deleted).toHaveLength(0)
  })

  it('★名前が一致しないと 400 name_mismatch で、何も消さない', async () => {
    const res = await call({ confirm_name: '某家電量販店様' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('name_mismatch')
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('名前の前後の空白は許す', async () => {
    const res = await call({ confirm_name: '  某家電量販店様 デモ ' })
    expect(res.status).toBe(200)
  })

  it('確認の名前が無い本文は 400 invalid_body', async () => {
    const res = await call({})
    expect(res.status).toBe(400)
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('★自分の所属テナントは消さない (締め出し防止)', async () => {
    h.guard = { ...superGuard, profile: { ...superGuard.profile, tenant_id: 't1' } }
    const res = await call({ confirm_name: '某家電量販店様 デモ' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('cannot_delete_own_tenant')
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('★全体管理者が所属するテナントは消さない', async () => {
    h.supers = 1
    const res = await call({ confirm_name: '某家電量販店様 デモ' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('tenant_has_super_admin')
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('無いテナントは 404', async () => {
    h.tenant = null
    const res = await call({ confirm_name: 'x' })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/admin/tenants/[id] — 削除と後始末', () => {
  it('★DB は RPC 1 回で消し、ユーザとエッジのアカウントを重複なく消し、監査を残す', async () => {
    const res = await call({ confirm_name: '某家電量販店様 デモ' })
    expect(res.status).toBe(200)
    expect(h.rpcCalls).toEqual([{ name: 'admin_delete_tenant', args: { p_tenant_id: 't1' } }])
    expect(h.deleted.sort()).toEqual(['e1', 'u1'])
    const j = await res.json()
    expect(j).toMatchObject({ ok: true, counts: { stores: 2, alarm_events: 3 }, auth: { deleted: 2, failed: 0 } })
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({
      action: 'tenant.delete', targetType: 'tenant', targetId: 't1',
      changes: { name: '某家電量販店様 デモ', auth_deleted: 2, storage_files: 'not_deleted' },
    })
  })

  it('アカウントの削除に失敗しても、DB からは消えているので成功で返し、失敗を記録する', async () => {
    h.failAuth = ['e1']
    const res = await call({ confirm_name: '某家電量販店様 デモ' })
    expect(res.status).toBe(200)
    expect((await res.json()).auth).toEqual({ deleted: 1, failed: 1 })
    expect(h.audits[0]).toMatchObject({ changes: { auth_failed: ['e1'] } })
  })

  it('★RPC が失敗したらアカウントは消さない (DB が残っているのに入れなくなるのを防ぐ)', async () => {
    h.rpc = { data: null, error: { message: 'update or delete on table "stores" violates foreign key' } }
    const res = await call({ confirm_name: '某家電量販店様 デモ' })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('delete_failed')
    expect(h.deleted).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
  })

  it('消したテナントを操作中にしていたら、その cookie を外す', async () => {
    const res = await call({ confirm_name: '某家電量販店様 デモ' }, 'acting_tenant=t1')
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie') ?? '').toMatch(/acting_tenant=;/)
  })

  it('別のテナントを操作中なら cookie は触らない', async () => {
    const res = await call({ confirm_name: '某家電量販店様 デモ' }, 'acting_tenant=other')
    expect(res.headers.get('set-cookie')).toBeNull()
  })
})
