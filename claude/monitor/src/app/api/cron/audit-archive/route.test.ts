import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 監査の記録の書き出しの cron の呼ばれ方。
 *   ★vercel.json に日次の GET として載っていて、Vercel Cron の形 (Bearer) で通る
 *   ★秘密が違うと何もしない
 *   ★書き出し先が未設定なら 503 (外へ出せていないことを Cron の記録に残す)
 *   ★backfill_days の範囲外は 400
 */

const h = vi.hoisted(() => ({ calls: [] as { days?: number }[], ok: true, configured: true }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseService: () => ({}) }))
vi.mock('@/lib/audit/archive-r2', () => ({
  auditArchiveConfigured: () => h.configured,
  r2ArchiveStore: () => ({}),
}))
vi.mock('@/lib/audit/archive', () => ({
  MAX_BACKFILL_DAYS: 400,
  runAuditArchive: async (_s: unknown, _st: unknown, o: { days?: number }) => {
    h.calls.push({ days: o.days })
    return { ok: h.ok, days: [], deferred: 0 }
  },
}))

import { GET } from './route'

const url = 'https://gvms-cloud.com/api/cron/audit-archive'
const call = (headers: Record<string, string> = {}, q = '') => GET(new NextRequest(url + q, { headers }))
const auth = { authorization: 'Bearer cron-secret-for-test' }

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret-for-test'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  h.calls = []; h.ok = true; h.configured = true
})
afterEach(() => {
  delete process.env.AUDIT_ARCHIVE_BACKFILL_DAYS
  delete process.env.CRON_SECRET
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
})

describe('/api/cron/audit-archive の呼ばれ方', () => {
  it('★vercel.json に日次の Cron として載っている', () => {
    const vercel = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../vercel.json', import.meta.url)), 'utf8')) as {
      crons: { path: string; schedule: string }[]
    }
    expect(vercel.crons.find((c) => c.path === '/api/cron/audit-archive')?.schedule).toMatch(/^\d+ \d+ \* \* \*$/)
  })

  it('★Vercel Cron の形 (GET・Bearer) で動く', async () => {
    const r = await call(auth)
    expect(r.status).toBe(200)
    expect(h.calls).toEqual([{ days: undefined }])
  })

  it('★秘密が違う・無いと何もしない', async () => {
    expect((await call({ authorization: 'Bearer wrong' })).status).toBe(401)
    expect((await call()).status).toBe(401)
    expect(h.calls).toHaveLength(0)
  })

  it('★書き出し先が未設定なら 503', async () => {
    h.configured = false
    const r = await call(auth)
    expect(r.status).toBe(503)
    expect(await r.json()).toEqual({ error: 'audit_archive_not_configured' })
    expect(h.calls).toHaveLength(0)
  })

  it('★backfill_days を渡せる・範囲外は 400', async () => {
    expect((await call(auth, '?backfill_days=120')).status).toBe(200)
    expect(h.calls).toEqual([{ days: 120 }])
    expect((await call(auth, '?backfill_days=0')).status).toBe(400)
    expect((await call(auth, '?backfill_days=401')).status).toBe(400)
    expect((await call(auth, '?backfill_days=x')).status).toBe(400)
  })

  it('★AUDIT_ARCHIVE_BACKFILL_DAYS があれば、指定の無い呼び出し (Run ボタン) もさかのぼる', async () => {
    process.env.AUDIT_ARCHIVE_BACKFILL_DAYS = '400'
    expect((await call(auth)).status).toBe(200)
    // 呼び出しの指定が優先
    expect((await call(auth, '?backfill_days=30')).status).toBe(200)
    expect(h.calls).toEqual([{ days: 400 }, { days: 30 }])
    process.env.AUDIT_ARCHIVE_BACKFILL_DAYS = '999'
    expect((await call(auth)).status).toBe(400)
    process.env.AUDIT_ARCHIVE_BACKFILL_DAYS = ' '
    expect((await call(auth)).status).toBe(200)
    expect(h.calls.at(-1)).toEqual({ days: undefined })
  })

  it('失敗があれば 500', async () => {
    h.ok = false
    expect((await call(auth)).status).toBe(500)
  })
})
