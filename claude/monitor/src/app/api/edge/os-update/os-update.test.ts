import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  authed: true,
  edge: null as Record<string, unknown> | null,
  edgeError: null as { code: string; message: string } | null,
  file: null as Record<string, unknown> | null,
  fileError: null as { code: string; message: string } | null,
  fileQueried: false,
}))

vi.mock('@/lib/edge/device-auth', () => ({
  authenticateEdge: async () => (h.authed ? { id: 'edge-1', store_id: 'store-1' } : null),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseService: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === 'edge_devices') return { data: h.edge, error: h.edgeError }
            h.fileQueried = true
            return { data: h.file, error: h.fileError }
          },
        }),
      }),
    }),
  }),
}))

import { GET } from './route'

const get = () => GET(new NextRequest('http://localhost/api/edge/os-update', { headers: { authorization: 'Bearer t' } }))
const SIGNED = 'nvmsosu1.eyJpZCI6IlgifQ.c2ln'
const CAPABLE = { agent_version: 'nvmsd/1.0.0', capabilities: ['grid', 'os_update'], os_update_file_id: 'file-1' }

beforeEach(() => {
  h.authed = true; h.edge = { ...CAPABLE }; h.edgeError = null
  h.file = { signed: SIGNED, withdrawn_at: null }; h.fileError = null; h.fileQueried = false
})

describe('GET /api/edge/os-update（接続仕様 §14）', () => {
  it('届けると選んだ拠点へ、預かった 1 行をそのまま返す', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ signed: SIGNED })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('トークンが違えば 401', async () => {
    h.authed = false
    expect((await get()).status).toBe(401)
  })

  it('届け先に選んでいなければ 204（台帳を引かない）', async () => {
    h.edge = { ...CAPABLE, os_update_file_id: null }
    expect((await get()).status).toBe(204)
    expect(h.fileQueried).toBe(false)
  })

  it('★os_update を名乗らない拠点には届けない', async () => {
    h.edge = { ...CAPABLE, capabilities: ['grid', 'ota'] }
    expect((await get()).status).toBe(204)
    h.edge = { ...CAPABLE, capabilities: null } // 名乗りの無い古い版（既定の一覧に os_update は無い）
    expect((await get()).status).toBe(204)
  })

  it('★取り下げたファイルは返さない', async () => {
    h.file = { signed: SIGNED, withdrawn_at: '2026-11-27T00:00:00Z' }
    expect((await get()).status).toBe(204)
  })

  it('大きすぎる 1 行は返さない（§14.1 の 64 KiB）', async () => {
    h.file = { signed: 'nvmsosu1.' + 'a'.repeat(64 * 1024), withdrawn_at: null }
    expect((await get()).status).toBe(204)
  })

  it('migration の前の DB（列・表が無い）でも 204 で、拠点の死活を落とさない', async () => {
    h.edge = null; h.edgeError = { code: '42703', message: 'column edge_devices.os_update_file_id does not exist' }
    expect((await get()).status).toBe(204)
    h.edge = { ...CAPABLE }; h.edgeError = null
    h.file = null; h.fileError = { code: '42P01', message: 'relation "os_update_files" does not exist' }
    expect((await get()).status).toBe(204)
  })
})
