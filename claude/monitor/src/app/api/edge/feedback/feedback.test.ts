import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/test/fake-supabase'

/**
 * 現場の受け口 POST /api/edge/feedback と GET /api/edge/feedback/status（GVMS_CLOUD_SPEC §12.2・§12.3）。
 *
 * 守りたい性質:
 *   ① 送り直しで増えない（同じ local_id は 200 で同じ id）
 *   ② 書けるのは拠点の管理者だけ・テナントが止めていれば 409・1 拠点 1 日 50 件
 *   ③ 本文の連絡先・URL・IP は伏せ字にしてから保存する（元の文を残さない）
 *   ④ context は既知の項目だけ残す（知らない項目は捨てる・拒否しない）
 *   ⑤ 状態の差分は「その拠点が送ったもの」だけ・since より後・古い順
 */

const EDGE = { id: 'edge-1', store_id: 'store-1' }
const OTHER_EDGE = { id: 'edge-2', store_id: 'store-2' }

const h = vi.hoisted(() => ({
  edge: null as { id: string; store_id: string } | null,
  db: null as unknown as ReturnType<typeof import('@/test/fake-supabase').createFakeDb>,
  notified: [] as { body: string; source: string }[],
}))

vi.mock('@/lib/edge/device-auth', () => ({ authenticateEdge: async () => h.edge }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseService: () => h.db.client }))
vi.mock('@/lib/feedback/notify', () => ({
  notifyBlockingFeedback: async (p: { body: string; source: string }) => { h.notified.push(p) },
}))

import { POST } from './route'
import { GET } from './status/route'

const LOCAL = '0b6c1f0e-6a51-4d0f-9a43-2f7e0c1d9a10'

function body(over: Record<string, unknown> = {}) {
  return {
    local_id: LOCAL, kind: 'request', urgency: 'inconvenient', body: '64 分割で時刻が読めない',
    contact_ok: true, role: 'admin', submitted_at: '2026-10-06T10:12:00+09:00',
    context: { screen: 'live.grid', agent_version: 'nvmsd/0.1.104', browser: 'chrome/141', os: 'windows', viewport: '1920x1080' },
    ...over,
  }
}
const post = (b: unknown) => POST(new NextRequest('http://localhost/api/edge/feedback', {
  method: 'POST', body: typeof b === 'string' ? b : JSON.stringify(b), headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
}))
const get = (q = '') => GET(new NextRequest(`http://localhost/api/edge/feedback/status${q}`, { headers: { authorization: 'Bearer t' } }))

function seed(opts: { feedbackEnabled?: boolean; items?: Record<string, unknown>[] } = {}) {
  h.db = createFakeDb({
    stores: [{ id: 'store-1', tenant_id: 'tenant-1', name: '本店' }, { id: 'store-2', tenant_id: 'tenant-1', name: '支店' }],
    tenants: [{ id: 'tenant-1', name: 'テナントA', feedback_enabled: opts.feedbackEnabled ?? true }],
    feedback_items: opts.items ?? [],
  }, {
    uniques: { feedback_items: [['edge_id', 'local_id']] },
    defaults: { feedback_items: () => ({ status: 'received', reply: null, fixed_version: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }) },
  })
}

beforeEach(() => {
  h.edge = EDGE
  h.notified = []
  seed()
})

describe('POST /api/edge/feedback — 受け付け', () => {
  it('201 で id を返し、拠点・テナント・source=gvms で保存する', async () => {
    const res = await post(body())
    expect(res.status).toBe(201)
    const { id } = await res.json()
    const row = h.db.rows('feedback_items')[0]
    expect(row).toMatchObject({
      id, tenant_id: 'tenant-1', store_id: 'store-1', edge_id: 'edge-1', source: 'gvms', local_id: LOCAL,
      kind: 'request', urgency: 'inconvenient', contact_ok: true, role: 'admin', submitted_by: null,
    })
    expect(row.submitted_at).toBe('2026-10-06T01:12:00.000Z')
  })

  it('★同じ local_id の送り直しは 200 で同じ id（増えない）', async () => {
    const first = await (await post(body())).json()
    const res = await post(body({ body: '送り直し' }))
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe(first.id)
    expect(h.db.rows('feedback_items')).toHaveLength(1)
  })

  it('別の拠点なら同じ local_id でも別の 1 件', async () => {
    await post(body())
    h.edge = OTHER_EDGE
    expect((await post(body())).status).toBe(201)
    expect(h.db.rows('feedback_items')).toHaveLength(2)
  })

  it('★本文の電話番号・メールアドレス・URL・IP を伏せ字にして保存する（元の文を残さない）', async () => {
    await post(body({ body: '090-1234-5678 か foo@example.com へ。https://192.168.0.10/x と 192.168.0.101 が見えない' }))
    const saved = String(h.db.rows('feedback_items')[0].body)
    expect(saved).not.toMatch(/090|foo@|https:|192\.168/)
    expect(saved).toContain('[電話番号]')
    expect(saved).toContain('[メールアドレス]')
    expect(saved).toContain('[URL]')
    expect(saved).toContain('[IP アドレス]')
  })

  it('★context は既知の項目だけ残す（知らない項目は捨てる・拒否しない）', async () => {
    const res = await post(body({
      context: {
        screen: 'live.grid', camera: { vendor: 'i-PRO', model: 'WV-S4176', firmware: '1.66', name: '本店 入口', ip: '192.168.0.101' },
        user_name: '山田', camera_name: '入口', password: 'x', extra: { deep: 1 },
      },
    }))
    expect(res.status).toBe(201)
    expect(h.db.rows('feedback_items')[0].context).toEqual({
      screen: 'live.grid', camera: { vendor: 'i-PRO', model: 'WV-S4176', firmware: '1.66' },
    })
  })

  it('★urgency=blocking は運営へすぐ知らせる（伏せ字の後の本文）', async () => {
    await post(body({ urgency: 'blocking', body: '録画が止まった。連絡は 03-1234-5678' }))
    expect(h.notified).toHaveLength(1)
    expect(h.notified[0].body).not.toContain('03-1234-5678')
    expect(h.notified[0].source).toBe('gvms')
  })

  it('blocking 以外は知らせない', async () => {
    await post(body())
    expect(h.notified).toHaveLength(0)
  })
})

describe('POST /api/edge/feedback — 断る', () => {
  it('トークンが違えば 401', async () => {
    h.edge = null
    expect((await post(body())).status).toBe(401)
  })

  it.each([
    ['本文が空', { body: '   ' }],
    ['本文が 1,001 字', { body: 'あ'.repeat(1001) }],
    ['kind が知らない値', { kind: 'complaint' }],
    ['urgency が知らない値', { urgency: 'urgent' }],
    ['local_id が UUID でない', { local_id: 'abc' }],
    ['role が無い', { role: undefined }],
  ])('%s は 400', async (_n, over) => {
    const res = await post(body(over))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_body')
    expect(h.db.rows('feedback_items')).toHaveLength(0)
  })

  it('本文がちょうど 1,000 字なら受ける（絵文字などのサロゲートペアも 1 字）', async () => {
    expect((await post(body({ body: '𠮷'.repeat(1000) }))).status).toBe(201)
  })

  it('JSON でなければ 400', async () => {
    expect((await post('{oops')).status).toBe(400)
  })

  it.each(['operator', 'viewer', 'tenant_admin', ''])('★role=%s は 403（書けるのは拠点の管理者だけ）', async (role) => {
    const res = await post(body({ role }))
    expect(res.status).toBe(403)
    expect(h.db.rows('feedback_items')).toHaveLength(0)
  })

  it('★テナントが止めていれば 409 feedback_disabled', async () => {
    seed({ feedbackEnabled: false })
    const res = await post(body())
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'feedback_disabled' })
    expect(h.db.rows('feedback_items')).toHaveLength(0)
  })

  it('★1 拠点 1 日 50 件を超えたら 429（日本時間の今日の分を数える）', async () => {
    const now = new Date().toISOString()
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: `old-${i}`, edge_id: 'edge-1', local_id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`, created_at: now,
    }))
    seed({ items })
    const res = await post(body())
    expect(res.status).toBe(429)
    expect((await res.json()).error).toBe('daily_limit')
  })

  it('前の日の分は数えない', async () => {
    const yesterday = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString()
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `old-${i}`, edge_id: 'edge-1', local_id: `l-${i}`, created_at: yesterday }))
    seed({ items })
    expect((await post(body())).status).toBe(201)
  })

  it('★上限を超えていても、受け付け済みの送り直しは 200（届いたものは届いたまま）', async () => {
    const now = new Date().toISOString()
    const items = [
      { id: 'mine', edge_id: 'edge-1', local_id: LOCAL, created_at: now },
      ...Array.from({ length: 50 }, (_, i) => ({ id: `old-${i}`, edge_id: 'edge-1', local_id: `l-${i}`, created_at: now })),
    ]
    seed({ items })
    const res = await post(body())
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe('mine')
  })
})

describe('GET /api/edge/feedback/status — 状態の差分', () => {
  const row = (id: string, edge: string, updated: string, extra: Record<string, unknown> = {}) => ({
    id, edge_id: edge, local_id: `local-${id}`, status: 'planned', reply: '0.1.105 で対応します', fixed_version: null, updated_at: updated, ...extra,
  })

  it('トークンが違えば 401', async () => {
    h.edge = null
    expect((await get()).status).toBe(401)
  })

  it('読めない since は 400', async () => {
    expect((await get('?since=yesterday')).status).toBe(400)
  })

  it('★その拠点が送ったものだけ・since より後・古い順', async () => {
    seed({
      items: [
        row('a', 'edge-1', '2026-10-07T09:00:00.000Z'),
        row('b', 'edge-1', '2026-10-06T09:00:00.000Z'),
        row('c', 'edge-1', '2026-10-05T09:00:00.000Z'),
        row('x', 'edge-2', '2026-10-07T10:00:00.000Z'),
      ],
    })
    const res = await get('?since=2026-10-05T09:00:00Z')
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.items.map((i: { id: string }) => i.id)).toEqual(['b', 'a'])
    expect(j.items[0]).toEqual({
      local_id: 'local-b', id: 'b', status: 'planned', reply: '0.1.105 で対応します', fixed_version: null, updated_at: '2026-10-06T09:00:00.000Z',
    })
    expect(j.next_since).toBeNull()
  })

  it('since が無ければ最初から', async () => {
    seed({ items: [row('a', 'edge-1', '2026-10-07T09:00:00.000Z')] })
    expect((await (await get()).json()).items).toHaveLength(1)
  })

  it('★200 件を超えたら next_since を付け、続けて取ると残りが返る', async () => {
    const base = Date.parse('2026-10-07T00:00:00Z')
    seed({ items: Array.from({ length: 250 }, (_, i) => row(`i${i}`, 'edge-1', new Date(base + i * 1000).toISOString())) })
    const p1 = await (await get()).json()
    expect(p1.items).toHaveLength(200)
    expect(p1.next_since).toBe(p1.items[199].updated_at)
    const p2 = await (await get(`?since=${encodeURIComponent(p1.next_since)}`)).json()
    expect(p2.items).toHaveLength(50)
    expect(p2.next_since).toBeNull()
    expect(new Set([...p1.items, ...p2.items].map((i: { id: string }) => i.id)).size).toBe(250)
  })
})
