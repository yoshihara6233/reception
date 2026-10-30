import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * 保持期間の削除の cron の呼ばれ方 (2026-10-30)。
 *
 * #432 で /api/admin/vod/cleanup が POST しか受けず、Vercel Cron (GET・Bearer) から
 * 一度も動いていなかった。同じことを起こさないよう、
 *   ★vercel.json に載っていて、Vercel Cron の形 (GET・Authorization: Bearer) で通る
 *   ★秘密が無い・違うと何もしない
 *   ★dry_run=1 は数えるだけ (同じ認証)
 * を確かめる。消す中身は src/lib/retention/data-retention.test.ts。
 */

const h = vi.hoisted(() => ({ calls: [] as { dryRun: boolean }[], ok: true }))
vi.mock('@/lib/supabase/server', () => ({ createSupabaseService: () => ({}) }))
vi.mock('@/lib/retention/data-retention', () => ({
  runDataRetention: async (_svc: unknown, o: { dryRun: boolean }) => {
    h.calls.push({ dryRun: o.dryRun })
    return { ok: h.ok, dry_run: o.dryRun, steps: {} }
  },
}))

import { GET } from './route'
import * as route from './route'

const url = 'https://gvms-cloud.com/api/cron/data-retention'
const call = (headers: Record<string, string> = {}, q = '') => GET(new NextRequest(url + q, { headers }))

beforeEach(() => {
  process.env.CRON_SECRET = 'cron-secret-for-test'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
  h.calls = []
  h.ok = true
})
afterEach(() => {
  delete process.env.CRON_SECRET
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
})

describe('/api/cron/data-retention の呼ばれ方', () => {
  it('★vercel.json に GET の Cron として載っている (日次)', () => {
    const vercel = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../../vercel.json', import.meta.url)), 'utf8')) as {
      crons: { path: string; schedule: string }[]
    }
    const job = vercel.crons.find((c) => c.path === '/api/cron/data-retention')
    expect(job?.schedule).toMatch(/^\d+ \d+ \* \* \*$/)
    // Vercel Cron は GET で呼ぶ。GET が無い受け口は動かない (#432)
    expect(typeof route.GET).toBe('function')
  })

  it('★Vercel Cron の形 (GET・Authorization: Bearer) で動く', async () => {
    const res = await call({ authorization: 'Bearer cron-secret-for-test' })
    expect(res.status).toBe(200)
    expect(h.calls).toEqual([{ dryRun: false }])
  })

  it('x-cron-secret でも動く', async () => {
    expect((await call({ 'x-cron-secret': 'cron-secret-for-test' })).status).toBe(200)
  })

  it('★秘密が無い・違う・長さが違うと 401 で何もしない', async () => {
    expect((await call()).status).toBe(401)
    expect((await call({ authorization: 'Bearer wrong-secret-for-tes' })).status).toBe(401)
    expect((await call({ authorization: 'Bearer cron' })).status).toBe(401)
    expect((await call({ authorization: 'cron-secret-for-test' })).status).toBe(401)
    expect(h.calls).toEqual([])
  })

  it('★CRON_SECRET が未設定なら 503 で何もしない (空の秘密で通さない)', async () => {
    delete process.env.CRON_SECRET
    expect((await call({ authorization: 'Bearer ' })).status).toBe(503)
    expect((await call({ authorization: 'Bearer undefined' })).status).toBe(503)
    expect(h.calls).toEqual([])
  })

  it('★dry_run=1 は数えるだけの動きで呼ぶ', async () => {
    const res = await call({ authorization: 'Bearer cron-secret-for-test' }, '?dry_run=1')
    expect(res.status).toBe(200)
    expect(h.calls).toEqual([{ dryRun: true }])
  })

  it('消せなかったものがあれば 500 (Cron の記録で失敗として見える)', async () => {
    h.ok = false
    expect((await call({ authorization: 'Bearer cron-secret-for-test' })).status).toBe(500)
  })
})
