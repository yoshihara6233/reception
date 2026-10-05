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
import { GET as getAttachment } from './[id]/attachment/route'
import { createHash } from 'node:crypto'

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

// ── 該当の画面の URL と画像 1 枚（GVMS_CLOUD_SPEC §12.2・§12.6） ──────────────────────

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

function postForm(payload: unknown, file?: { bytes: Uint8Array; type?: string; name?: string } | string) {
  const form = new FormData()
  form.set('payload', typeof payload === 'string' ? payload : JSON.stringify(payload))
  if (typeof file === 'string') form.set('attachment', file)
  else if (file) form.set('attachment', new File([Buffer.from(file.bytes)], file.name ?? 'shot.png', { type: file.type ?? 'image/png' }))
  return POST(new NextRequest('http://localhost/api/feedback', { method: 'POST', body: form }))
}

describe('POST /api/feedback — 該当の画面の URL と画像', () => {
  it('★page_url は画面の場所だけにして保存する（https の URL はパスとクエリに）', async () => {
    await post({ ...valid, page_url: 'https://gvms-cloud.com/stores?tab=edge' })
    expect(h.db.rows('feedback_items')[0].page_url).toBe('/stores?tab=edge')
  })

  it('形の違う page_url は捨てて、要望は受ける', async () => {
    expect((await post({ ...valid, page_url: 'stores' })).status).toBe(201)
    expect(h.db.rows('feedback_items')[0].page_url).toBeNull()
  })

  it('★画像つき（multipart）は置き場に置き、宣言と受けた印を書く', async () => {
    const res = await postForm({ ...valid, page_url: '/settings/feedback' }, { bytes: PNG })
    expect(res.status).toBe(201)
    const row = h.db.rows('feedback_items')[0]
    const { id } = await res.json()
    expect(row).toMatchObject({
      id, page_url: '/settings/feedback',
      attachment_type: 'image/png', attachment_size: PNG.length, attachment_sha256: sha(PNG),
      attachment_path: `${TENANT}/${id}`,
    })
    expect(typeof row.attachment_received_at).toBe('string')
    expect([...h.db.objects.get(`feedback-attachments/${TENANT}/${id}`)!.bytes]).toEqual([...PNG])
  })

  it('★形式はブラウザの種類ではなく先頭の印で決める（GIF を image/png と名乗っても 400）', async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2])
    const res = await postForm(valid, { bytes: gif, type: 'image/png' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_attachment')
    expect(h.db.rows('feedback_items')).toHaveLength(0)
    expect(h.db.objects.size).toBe(0)
  })

  it('★3 MiB を超える画像は 413 で、何も入れない', async () => {
    const big = new Uint8Array(3 * 1024 * 1024 + 1)
    big.set(PNG)
    const res = await postForm(valid, { bytes: big })
    expect(res.status).toBe(413)
    expect(h.db.rows('feedback_items')).toHaveLength(0)
  })

  it('attachment が文字列なら 400・payload が無ければ 400', async () => {
    expect((await postForm(valid, 'not-a-file')).status).toBe(400)
    const form = new FormData()
    form.set('attachment', new File([Buffer.from(PNG)], 'a.png'))
    expect((await POST(new NextRequest('http://localhost/api/feedback', { method: 'POST', body: form }))).status).toBe(400)
  })

  it('★テナント管理者以外は画像つきでも 403 で、置き場に届かない', async () => {
    as('super_admin')
    expect((await postForm(valid, { bytes: PNG })).status).toBe(403)
    expect(h.db?.objects.size ?? 0).toBe(0)
  })

  it('画像を置けなければ 500 で、要望も入れない', async () => {
    h.db.storageFail.upload = true
    expect((await postForm(valid, { bytes: PNG })).status).toBe(500)
    expect(h.db.rows('feedback_items')).toHaveLength(0)
  })

  it('★一覧は置き場の場所を出さず、画像の有無だけ返す', async () => {
    seed(true, [{ id: 'mine', tenant_id: TENANT, created_at: '2026-10-06T00:00:00Z', page_url: '/x', attachment_path: `${TENANT}/mine`, attachment_purged_at: null }])
    const j = await (await GET()).json()
    expect(j.items[0]).toMatchObject({ id: 'mine', page_url: '/x', has_attachment: true, attachment_purged: false })
    expect(j.items[0]).not.toHaveProperty('attachment_path')
  })
})

describe('GET /api/feedback/[id]/attachment — 画像を見る', () => {
  const ID = '00000000-0000-4000-8000-0000000000f1'
  const OTHER = '00000000-0000-4000-8000-0000000000f2'
  const open = (id: string) => getAttachment(new NextRequest(`http://localhost/api/feedback/${id}/attachment`), { params: Promise.resolve({ id }) })

  beforeEach(() => {
    seed(true, [
      { id: ID, tenant_id: TENANT, attachment_path: `${TENANT}/${ID}` },
      { id: OTHER, tenant_id: 'tenant-2', attachment_path: `tenant-2/${OTHER}` },
    ])
  })

  it('★自分のテナントの画像は期限つきの URL へ 302', async () => {
    const res = await open(ID)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toContain(`feedback-attachments/${TENANT}/${ID}`)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('★他のテナントの画像は 404（ID を知っていても届かない）', async () => {
    const res = await open(OTHER)
    expect(res.status).toBe(404)
  })

  it.each(['super_admin', 'store_manager', 'viewer'])('★%s は 403', async (role) => {
    as(role)
    expect((await open(ID)).status).toBe(403)
  })

  it('画像の無い要望は 404', async () => {
    seed(true, [{ id: ID, tenant_id: TENANT, attachment_path: null }])
    expect((await open(ID)).status).toBe(404)
  })
})
