import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb } from '@/test/fake-supabase'

/**
 * 要望の画像の片付け cron（GVMS_CLOUD_SPEC §12.6「受けてから 1 年で消す」）。
 *
 *   ★受けてから 365 日を過ぎた画像だけを消す（365 日以内・受けていないものは残す）
 *   ★消したら path と受けた時刻を空にし、消した時刻を書く（宣言は残す）
 *   ★消すのに失敗したら行を書き換えない（次の実行で取り直す）
 *   ★CRON_SECRET が無い・違えば何もしない
 */

const h = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import('@/test/fake-supabase').createFakeDb>,
}))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseService: () => h.db.client }))

import { GET } from './route'

const DAY = 24 * 60 * 60 * 1000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()
const decl = { attachment_type: 'image/png', attachment_size: 10, attachment_sha256: 'a'.repeat(64) }

function seed() {
  h.db = createFakeDb({
    feedback_items: [
      { id: 'old', tenant_id: 't1', ...decl, attachment_path: 't1/old', attachment_received_at: ago(366) },
      { id: 'older', tenant_id: 't2', ...decl, attachment_path: 't2/older', attachment_received_at: ago(800) },
      { id: 'recent', tenant_id: 't1', ...decl, attachment_path: 't1/recent', attachment_received_at: ago(364) },
      { id: 'pending', tenant_id: 't1', ...decl, attachment_path: null, attachment_received_at: null },
      { id: 'none', tenant_id: 't1', attachment_path: null, attachment_received_at: null },
    ],
  })
  for (const p of ['t1/old', 't2/older', 't1/recent']) h.db.objects.set(`feedback-attachments/${p}`, { bytes: new Uint8Array([1]) })
}

const call = (headers: Record<string, string> = { authorization: 'Bearer s3cret' }) =>
  GET(new NextRequest('http://localhost/api/cron/feedback-attachments', { headers }))
const row = (id: string) => h.db.rows('feedback_items').find((r) => r.id === id)!

beforeEach(() => {
  process.env.CRON_SECRET = 's3cret'
  seed()
})

describe('/api/cron/feedback-attachments', () => {
  it('★365 日を過ぎた画像だけを消し、列を空にして消した時刻を書く', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, purged: 2, failed: 0 })

    for (const id of ['old', 'older']) {
      expect(row(id)).toMatchObject({ attachment_path: null, attachment_received_at: null, attachment_sha256: 'a'.repeat(64) })
      expect(typeof row(id).attachment_purged_at).toBe('string')
    }
    expect(h.db.objects.has('feedback-attachments/t1/old')).toBe(false)
    expect(h.db.objects.has('feedback-attachments/t2/older')).toBe(false)

    // 365 日以内・まだ受けていない・画像なしは触らない
    expect(row('recent').attachment_path).toBe('t1/recent')
    expect(h.db.objects.has('feedback-attachments/t1/recent')).toBe(true)
    expect(row('pending').attachment_purged_at ?? null).toBeNull()
    expect(row('none').attachment_purged_at ?? null).toBeNull()
  })

  it('2 回目は何もしない', async () => {
    await call()
    expect(await (await call()).json()).toMatchObject({ purged: 0 })
  })

  it('★置き場から消せなければ行を書き換えない（次の実行で取り直す）', async () => {
    h.db.storageFail.remove = true
    const j = await (await call()).json()
    expect(j).toMatchObject({ purged: 0, failed: 2 })
    expect(row('old').attachment_path).toBe('t1/old')
    expect(row('old').attachment_purged_at ?? null).toBeNull()
  })

  it('★CRON_SECRET が違えば 401・未設定なら 503（何も消さない）', async () => {
    expect((await call({ authorization: 'Bearer nope' })).status).toBe(401)
    delete process.env.CRON_SECRET
    expect((await call()).status).toBe(503)
    expect(row('old').attachment_path).toBe('t1/old')
  })

  it('x-cron-secret でも通る', async () => {
    expect((await call({ 'x-cron-secret': 's3cret' })).status).toBe(200)
  })
})
