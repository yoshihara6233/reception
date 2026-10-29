import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// 削除の本体 (サービスの接続) までは進ませない: 鍵を空にして server_misconfigured で止まることを「認証を通った」印にする
const guard = vi.hoisted(() => ({ ok: false as boolean }))
vi.mock('@/lib/admin/guard', () => ({
  requireSuperAdmin: async () => (guard.ok
    ? { ok: true, user: { id: 'u' }, profile: { role: 'super_admin' } }
    : { ok: false, error: 'forbidden', status: 403 }),
}))

import { GET, POST } from './route'

const url = 'https://gvms-cloud.com/api/admin/vod/cleanup'

describe('vod/cleanup の Cron の認証 (2026-10-29)', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-secret-for-test'
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    guard.ok = false
  })
  afterEach(() => { delete process.env.CRON_SECRET })

  it('Vercel Cron の形 (GET・Bearer) で通る (以前は GET が無く、一度も動いていなかった)', async () => {
    const res = await GET(new NextRequest(url, { headers: { authorization: 'Bearer cron-secret-for-test' } }))
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('server_misconfigured')
  })

  it('GET は秘密が無い・違うと 401', async () => {
    expect((await GET(new NextRequest(url))).status).toBe(401)
    expect((await GET(new NextRequest(url, { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401)
  })

  it('POST の x-cron-secret も今までどおり通る', async () => {
    const res = await POST(new NextRequest(url, { method: 'POST', headers: { 'x-cron-secret': 'cron-secret-for-test' } }))
    expect((await res.json()).error).toBe('server_misconfigured')
  })

  it('手で呼べるのは運営だけ (テナント管理者は 403)', async () => {
    const res = await POST(new NextRequest(url, { method: 'POST', body: '{}' }))
    expect(res.status).toBe(403)
  })

  it('保持日数 (31 日) より短い指定は断る (全テナントの新しい映像を消させない)', async () => {
    guard.ok = true
    const res = await POST(new NextRequest(url, { method: 'POST', body: JSON.stringify({ older_than_days: 1 }) }))
    expect(res.status).toBe(400)
  })
})
