import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/test/fake-supabase'

/**
 * 要望ボードの受け口（super_admin 専用）。
 *
 *   ★話題の状態を変えると、束ねた要望の状態・返事・対応の版も変わる（基本設計 §3.5）
 *   ★変更は feedback_events と運営アクセスログ（admin_audit_log）に残る
 *   ★見送り（declined）は返事が必須
 *   ★ファイルの取り込みは local_id で重複を除き、伏せ字にしてから入れる
 *   ★super_admin 以外は使えない
 */

const h = vi.hoisted(() => ({
  role: 'super_admin' as string | null,
  db: null as unknown as ReturnType<typeof import('@/test/fake-supabase').createFakeDb>,
  audits: [] as Record<string, unknown>[],
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: h.role ? { id: 'ops-1' } : null } }) },
    from: (table: string) => {
      if (table === 'admin_users') {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: h.role ? { id: 'p', role: h.role, tenant_id: null, store_ids: [] } : null }) }) }) }
      }
      if (table === 'admin_audit_log') {
        return { insert: async (row: Record<string, unknown>) => { h.audits.push(row); return { error: null } } }
      }
      throw new Error(`unexpected session table ${table}`)
    },
  }),
  createSupabaseService: () => h.db.client,
}))

import { PATCH as patchTopic } from './topics/[id]/route'
import { POST as createTopic } from './topics/route'
import { PATCH as patchItem } from './items/[id]/route'
import { POST as importFile } from './import/route'
import { GET as listBoard } from './route'

const T1 = '00000000-0000-4000-8000-0000000000a1'
const I1 = '00000000-0000-4000-8000-0000000000b1'
const I2 = '00000000-0000-4000-8000-0000000000b2'
const I3 = '00000000-0000-4000-8000-0000000000b3'

const req = (url: string, method: string, body?: unknown) =>
  new NextRequest(`http://localhost${url}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

function seed() {
  const ts = '2026-10-06T00:00:00.000Z'
  h.db = createFakeDb({
    feedback_topics: [{ id: T1, title: '64 分割の時刻', status: 'reviewing', reply: null, fixed_version: null, internal_note: '社内メモ' }],
    feedback_items: [
      { id: I1, tenant_id: 'tn1', store_id: 's1', topic_id: T1, status: 'received', reply: null, fixed_version: null, updated_at: ts },
      { id: I2, tenant_id: 'tn2', store_id: 's2', topic_id: T1, status: 'reviewing', reply: null, fixed_version: null, updated_at: ts },
      { id: I3, tenant_id: 'tn1', store_id: 's1', topic_id: null, status: 'received', reply: null, fixed_version: null, updated_at: ts },
    ],
    stores: [{ id: '00000000-0000-4000-8000-00000000000c', tenant_id: '00000000-0000-4000-8000-00000000000d', name: '閉域の拠点' }],
  }, {
    // DB のトリガ（status / reply / fixed_version が変わったら updated_at を進める）の代わり
    onUpdate: {
      feedback_items: (b, a) => (
        b.status !== a.status || b.reply !== a.reply || b.fixed_version !== a.fixed_version
          ? { ...a, updated_at: '2026-10-07T00:00:00.000Z' } : { ...a, updated_at: b.updated_at }
      ),
    },
    defaults: { feedback_topics: () => ({ reply: null, fixed_version: null }) },
  })
}

beforeEach(() => {
  h.role = 'super_admin'
  h.audits = []
  seed()
})

const item = (id: string) => h.db.rows('feedback_items').find((r) => r.id === id)!

describe('話題の状態の波及（PATCH /api/admin/feedback/topics/[id]）', () => {
  it('★話題を「対応しました」にすると、束ねた要望すべてに状態・返事・版が写り、差分取得の時刻が進む', async () => {
    const res = await patchTopic(req(`/api/admin/feedback/topics/${T1}`, 'PATCH', {
      status: 'done', reply: '0.1.104 で対応しました', fixed_version: '0.1.104',
    }), params(T1))
    expect(res.status).toBe(200)
    expect((await res.json()).cascaded).toBe(2)
    for (const id of [I1, I2]) {
      expect(item(id)).toMatchObject({ status: 'done', reply: '0.1.104 で対応しました', fixed_version: '0.1.104', updated_at: '2026-10-07T00:00:00.000Z' })
    }
    // 束ねていない要望は変わらない
    expect(item(I3)).toMatchObject({ status: 'received', reply: null })
  })

  it('★変更は feedback_events（話題 1 行 + 要望ごと）と運営アクセスログに残る', async () => {
    await patchTopic(req(`/api/admin/feedback/topics/${T1}`, 'PATCH', { status: 'planned' }), params(T1))
    const ev = h.db.rows('feedback_events')
    expect(ev.filter((e) => e.action === 'topic.update')).toHaveLength(1)
    expect(ev.filter((e) => e.action === 'topic.cascade').map((e) => e.item_id).sort()).toEqual([I1, I2])
    expect(ev.find((e) => e.item_id === I1)).toMatchObject({ actor_user_id: 'ops-1', before: { status: 'received' }, after: { status: 'planned' } })
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({ action: 'feedback.topic.update', target_type: 'feedback_topic', target_id: T1 })
  })

  it('内部メモ・WBS・課題 URL は要望へ写さない（運営アクセスログにも中身を残さない）', async () => {
    await patchTopic(req(`/api/admin/feedback/topics/${T1}`, 'PATCH', { internal_note: '新しい社内メモ', wbs_ref: 'D-2-21' }), params(T1))
    expect(Object.keys(item(I1))).not.toContain('internal_note')
    expect(h.db.rows('feedback_events').filter((e) => e.action === 'topic.cascade')).toHaveLength(0)
    expect(JSON.stringify(h.audits[0].changes)).not.toContain('新しい社内メモ')
  })

  it('★見送りは返事が必須（400）。返事を付ければ要望にも返事ごと写る', async () => {
    const ng = await patchTopic(req(`/api/admin/feedback/topics/${T1}`, 'PATCH', { status: 'declined' }), params(T1))
    expect(ng.status).toBe(400)
    expect((await ng.json()).error).toBe('reply_required')
    expect(item(I1).status).toBe('received')

    const ok = await patchTopic(req(`/api/admin/feedback/topics/${T1}`, 'PATCH', { status: 'declined', reply: '今回は見送ります（理由）' }), params(T1))
    expect(ok.status).toBe(200)
    expect(item(I2)).toMatchObject({ status: 'declined', reply: '今回は見送ります（理由）' })
  })

  it('値の変わらない保存では何も書かない', async () => {
    const res = await patchTopic(req(`/api/admin/feedback/topics/${T1}`, 'PATCH', { status: 'reviewing' }), params(T1))
    expect((await res.json()).changed).toBe(false)
    expect(h.db.rows('feedback_events')).toHaveLength(0)
  })

  it('https 以外の課題 URL は断る（javascript: をリンクにしない）', async () => {
    expect((await patchTopic(req(`/api/admin/feedback/topics/${T1}`, 'PATCH', { issue_url: 'javascript:alert(1)' }), params(T1))).status).toBe(400)
  })
})

describe('要望 1 件（PATCH /api/admin/feedback/items/[id]）', () => {
  it('状態と返事を変えられ、記録が残る', async () => {
    const res = await patchItem(req(`/api/admin/feedback/items/${I3}`, 'PATCH', { status: 'answered', reply: '設定 → 表示 で変えられます' }), params(I3))
    expect(res.status).toBe(200)
    expect(item(I3)).toMatchObject({ status: 'answered', reply: '設定 → 表示 で変えられます' })
    expect(h.db.rows('feedback_events')[0]).toMatchObject({ item_id: I3, action: 'item.update' })
    expect(h.audits[0]).toMatchObject({ action: 'feedback.item.update', target_id: I3, store_id: 's1' })
  })

  it('★見送りは返事が必須', async () => {
    const res = await patchItem(req(`/api/admin/feedback/items/${I3}`, 'PATCH', { status: 'declined', reply: '  ' }), params(I3))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('reply_required')
  })

  it('★話題に束ねると、話題の状態を受け継ぐ', async () => {
    await patchTopic(req(`/api/admin/feedback/topics/${T1}`, 'PATCH', { status: 'planned', reply: '次の版で対応します' }), params(T1))
    const res = await patchItem(req(`/api/admin/feedback/items/${I3}`, 'PATCH', { topic_id: T1 }), params(I3))
    expect(res.status).toBe(200)
    expect(item(I3)).toMatchObject({ topic_id: T1, status: 'planned', reply: '次の版で対応します' })
    expect(h.db.rows('feedback_events').some((e) => e.item_id === I3 && e.action === 'item.bundle')).toBe(true)
  })

  it('知らない話題には束ねられない（404）', async () => {
    const res = await patchItem(req(`/api/admin/feedback/items/${I3}`, 'PATCH', { topic_id: '00000000-0000-4000-8000-0000000000ff' }), params(I3))
    expect(res.status).toBe(404)
  })
})

describe('話題を作る（POST /api/admin/feedback/topics）', () => {
  it('選んだ要望を束ねて作る', async () => {
    const res = await createTopic(req('/api/admin/feedback/topics', 'POST', { title: '録画の欠け', item_ids: [I3] }))
    expect(res.status).toBe(201)
    const { id } = await res.json()
    expect(item(I3)).toMatchObject({ topic_id: id, status: 'reviewing' })
    expect(h.audits[0]).toMatchObject({ action: 'feedback.topic.create' })
  })
})

describe('ファイルから取り込む（POST /api/admin/feedback/import）', () => {
  const TENANT = '00000000-0000-4000-8000-00000000000d'
  const STORE = '00000000-0000-4000-8000-00000000000c'
  const it1 = { local_id: '11111111-1111-4111-8111-111111111111', kind: 'bug', urgency: 'blocking', body: '連絡は 090-1234-5678', contact_ok: true, role: 'admin', context: { screen: 'live.grid', camera_name: '入口' } }
  const it2 = { ...it1, local_id: '22222222-2222-4222-8222-222222222222', body: '二件目' }
  const file = (items: unknown[]) => ({ format: 'gvms-feedback-export/1', site: { name: '閉域の拠点', agent_version: 'nvmsd/0.1.104' }, items })

  it('★source=import で入れ、伏せ字にし、2 回目は重複として飛ばす', async () => {
    const r1 = await importFile(req('/api/admin/feedback/import', 'POST', { tenant_id: TENANT, store_id: STORE, file: file([it1, it2, it1]) }))
    expect(r1.status).toBe(200)
    expect(await r1.json()).toEqual({ imported: 2, duplicates: 1, invalid: [] })
    const rows = h.db.rows('feedback_items').filter((r) => r.source === 'import')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ tenant_id: TENANT, store_id: STORE, edge_id: null, context: { screen: 'live.grid' } })
    expect(String(rows[0].body)).not.toContain('090-1234-5678')

    const r2 = await importFile(req('/api/admin/feedback/import', 'POST', { tenant_id: TENANT, store_id: STORE, file: file([it1, it2]) }))
    expect(await r2.json()).toEqual({ imported: 0, duplicates: 2, invalid: [] })
  })

  it('形の誤り・管理者以外の要望は飛ばして理由を返す', async () => {
    const res = await importFile(req('/api/admin/feedback/import', 'POST', {
      tenant_id: TENANT, store_id: STORE, file: file([{ ...it1, role: 'operator' }, { ...it2, kind: 'x' }]),
    }))
    expect(await res.json()).toEqual({ imported: 0, duplicates: 0, invalid: [{ index: 0, reason: 'role_not_allowed' }, { index: 1, reason: 'invalid_item' }] })
  })

  it('形式が違うファイル・テナントに属さない拠点は 400', async () => {
    const r1 = await importFile(req('/api/admin/feedback/import', 'POST', { tenant_id: TENANT, store_id: STORE, file: { format: 'other/1', items: [] } }))
    expect((await r1.json()).error).toBe('unknown_format')
    const r2 = await importFile(req('/api/admin/feedback/import', 'POST', { tenant_id: '00000000-0000-4000-8000-0000000000ee', store_id: STORE, file: file([]) }))
    expect((await r2.json()).error).toBe('store_tenant_mismatch')
  })
})

describe('★super_admin 以外は使えない', () => {
  it.each(['tenant_admin', 'store_manager', 'viewer'])('%s は 403', async (role) => {
    h.role = role
    expect((await patchTopic(req(`/api/admin/feedback/topics/${T1}`, 'PATCH', { status: 'done' }), params(T1))).status).toBe(403)
    expect((await patchItem(req(`/api/admin/feedback/items/${I1}`, 'PATCH', { status: 'done' }), params(I1))).status).toBe(403)
    expect((await createTopic(req('/api/admin/feedback/topics', 'POST', { title: 'x' }))).status).toBe(403)
    expect((await listBoard(req('/api/admin/feedback?format=csv', 'GET'))).status).toBe(403)
    expect(item(I1).status).toBe('received')
  })
})

describe('CSV の書き出し', () => {
  it('同じ絞り込みで CSV を返す（BOM 付き）', async () => {
    const res = await listBoard(req('/api/admin/feedback?view=all&format=csv', 'GET'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    const bytes = new Uint8Array(await res.arrayBuffer())
    // Response.text() は BOM を落として読むので、バイト列で確かめる（Excel が UTF-8 と判断する印）
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const text = new TextDecoder().decode(bytes)
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(1 + 3)
  })
})
