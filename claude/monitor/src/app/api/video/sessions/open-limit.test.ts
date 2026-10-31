import { beforeEach, describe, expect, it, vi } from 'vitest'

// 遠隔視聴の開始で同時視聴の上限を確かめる (2026-10-31・判断 A)。判定は DB の open_video_session
const h = vi.hoisted(() => ({
  rpcResult: { data: null as unknown, error: null as unknown },
  rpcArgs: null as Record<string, unknown> | null,
}))
const CAM = '33333333-3333-4333-8333-333333333333'

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'a@b.jp' } } }) },
    from: (t: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => t === 'recorder_cameras'
          ? { data: { id: CAM, recorders: { edge_id: 'e1', stores: { store_id: 's1', agent_version: 'nvmsd/0.1.204', capabilities: ['hls_live', 'hls_vod'] } } } }
          : { data: { display_name: '田中', email: 'a@b.jp' } },
      }
      return q
    },
  }),
  createSupabaseService: () => ({
    rpc: (_fn: string, args: Record<string, unknown>) => {
      h.rpcArgs = args
      return { single: async () => h.rpcResult }
    },
  }),
}))
vi.mock('@/lib/limits/heavy', () => ({ heavyAllows: async () => ({ ok: true }), tooManyRequests: () => new Response(null, { status: 429 }) }))
vi.mock('@/lib/storage/video-r2', () => ({ videoR2Configured: () => true }))
vi.mock('@/lib/edge/capabilities', () => ({ hasCapability: () => true }))
vi.mock('@/lib/metrics', () => ({ recordMetric: async () => {} }))
vi.mock('@/lib/livekit', () => ({ gvmsSfuEnabled: () => false }))

const call = async () => {
  const { POST } = await import('./route')
  return POST(new Request('http://localhost/api/video/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ camera_id: CAM, kind: 'hls_live' }),
  }))
}

describe('POST /api/video/sessions の同時視聴の上限', () => {
  beforeEach(() => { h.rpcArgs = null })

  it('上限に達していれば 429 で断る', async () => {
    h.rpcResult = { data: { session_id: null, active_count: 2, limit_max: 2, rejected: true }, error: null }
    const res = await call()
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ error: 'session_limit_reached', limit: 2, active: 2 })
  })
  it('空きがあれば 201 で id を返し、本人とカメラを DB の関数に渡す', async () => {
    h.rpcResult = { data: { session_id: 'v1', active_count: 1, limit_max: 2, rejected: false }, error: null }
    const res = await call()
    expect(res.status).toBe(201)
    expect((await res.json()).id).toBe('v1')
    expect(h.rpcArgs).toMatchObject({ p_user: 'u1', p_store_id: 's1', p_edge_id: 'e1', p_camera_id: CAM, p_kind: 'hls_live' })
  })
  it('判定に失敗したら通さない (フェイルクローズ)', async () => {
    h.rpcResult = { data: null, error: { message: 'x' } }
    expect((await call()).status).toBe(500)
  })
})
