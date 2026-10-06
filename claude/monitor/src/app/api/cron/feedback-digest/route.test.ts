import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/test/fake-supabase'

/**
 * 要望の新着のまとめメール cron（基本設計 §3.5）。
 *
 *   ★前日 8:30〜当日 8:30（日本時間）に届いた要望だけを 1 通で ALERT_EMAILS へ送る
 *   ★新着が 0 件・宛先が無いときは送らない
 *   ★CRON_SECRET が無い・違えば何もしない
 */

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('@/test/fake-supabase').createFakeDb>,
  sent: [] as { to: string[]; subject: string; html: string }[],
  sendOk: true,
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseService: () => h.db.client }))
vi.mock('@/lib/email/send', () => ({
  SECURITY_FROM_ADDRESS: 'G・VMS-Cloud <no-reply@genesis-edge.com>',
  sendEmail: async (to: string | string[], subject: string, html: string) => {
    h.sent.push({ to: Array.isArray(to) ? to : [to], subject, html })
    return { ok: h.sendOk }
  },
}))

import { GET } from './route'

const fb = (id: string, created_at: string, over: Record<string, unknown> = {}) => ({
  id, tenant_id: 't1', store_id: 's1', source: 'gvms', kind: 'request', urgency: 'nice_to_have',
  body: `本文 ${id}`, created_at, page_url: null, attachment_type: null, status: 'received', reply: null, ...over,
})

function seed() {
  h.db = createFakeDb({
    tenants: [{ id: 't1', name: '某ドラッグストア様' }],
    stores: [{ id: 's1', name: '銀座デモ店' }],
    feedback_items: [
      fb('before', '2026-10-05T23:29:59.000Z'), // 前日 8:30 より前 → 載せない
      fb('in1', '2026-10-06T00:19:58.000Z'),
      fb('in2', '2026-10-06T05:00:00.000Z', { urgency: 'blocking', reply: '確認中です' }),
      fb('after', '2026-10-06T23:31:00.000Z'), // 当日 8:30 より後 → 翌朝
    ],
  })
}

const call = (headers: Record<string, string> = { authorization: 'Bearer s3cret' }) =>
  GET(new NextRequest('http://localhost/api/cron/feedback-digest', { headers }))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-06T23:32:00Z')) // 10/7 8:32 JST
  process.env.CRON_SECRET = 's3cret'
  process.env.ALERT_EMAILS = 'ops@example.com, dev@example.com'
  h.sent = []
  h.sendOk = true
  seed()
})
afterEach(() => {
  vi.useRealTimers()
  delete process.env.ALERT_EMAILS
})

describe('/api/cron/feedback-digest', () => {
  it('★前日 8:30〜当日 8:30 の新着を 1 通で送る', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, count: 2, mailed: true, from: '2026-10-05T23:30:00.000Z', to: '2026-10-06T23:30:00.000Z' })
    expect(h.sent).toHaveLength(1)
    expect(h.sent[0].to).toEqual(['ops@example.com', 'dev@example.com'])
    expect(h.sent[0].subject).toBe('[G・VMS-Cloud] 要望の新着 2 件（業務が止まる 1 件）')
    expect(h.sent[0].html).toContain('本文 in1')
    expect(h.sent[0].html).toContain('本文 in2')
    expect(h.sent[0].html).not.toContain('本文 before')
    expect(h.sent[0].html).not.toContain('本文 after')
    expect(h.sent[0].html).toContain('某ドラッグストア様 / 銀座デモ店')
    // 未対応 = 受け付けたまま返事もしていない (in2 は返事を書いたので外れる)
    expect(h.sent[0].html).toContain('全部で 3 件')
  })

  it('★新着が 0 件なら送らない', async () => {
    vi.setSystemTime(new Date('2026-10-09T23:32:00Z'))
    expect(await (await call()).json()).toMatchObject({ ok: true, count: 0, mailed: false })
    expect(h.sent).toHaveLength(0)
  })

  it('★宛先が無ければ送らない', async () => {
    process.env.ALERT_EMAILS = ''
    expect(await (await call()).json()).toMatchObject({ ok: true, count: 2, mailed: false, skipped: 'no_recipients' })
    expect(h.sent).toHaveLength(0)
  })

  it('送れなかったら 502 を返す (cron の失敗として残す)', async () => {
    h.sendOk = false
    expect((await call()).status).toBe(502)
  })

  it('★CRON_SECRET が違えば 401・無ければ 503', async () => {
    expect((await call({ authorization: 'Bearer wrong' })).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await call()).status).toBe(503)
    expect(h.sent).toHaveLength(0)
  })
})
