import { beforeEach, describe, expect, it, vi } from 'vitest'

// 店舗の作業にある組だけに発行すること (ASVS 2.2.3)
const state: { edge: unknown; job: unknown; jobErr: unknown } = { edge: null, job: null, jobErr: null }
const filters: Record<string, unknown> = {}

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseService: () => ({
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: (k: string, v: unknown) => { if (table === 'inspection_clip_jobs') filters[k] = v; return q },
        limit: () => q,
        maybeSingle: async () => table === 'edge_devices'
          ? { data: state.edge, error: null }
          : { data: state.job, error: state.jobErr },
      }
      return q
    },
  }),
}))
vi.mock('@/lib/baggage/r2', () => ({
  r2Configured: () => false,
  presignClipPut: async () => 'https://r2.example/put',
  toR2Path: (k: string) => `r2:${k}`,
}))

const S = '11111111-2222-4333-8444-555555555555'
const C = '99999999-2222-4333-8444-555555555555'
const call = async () => {
  const { POST } = await import('./route')
  return POST(new Request('http://localhost/api/baggage/edge/clip-upload', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: S, cameraId: C }),
  }) as never)
}

describe('POST /api/baggage/edge/clip-upload', () => {
  beforeEach(() => { state.edge = { id: 'e1', store_id: 'store-a' }; state.job = null; state.jobErr = null })

  it('店舗の作業に無い組は断り、作業の絞り込みに店舗を使う', async () => {
    expect((await call()).status).toBe(403)
    expect(filters).toMatchObject({ session_id: S, camera_id: C, store_id: 'store-a' })
  })
  it('作業にある組は通す', async () => {
    state.job = { id: 'j1' }
    const res = await call()
    expect(res.status).toBe(200)
    expect((await res.json()).mode).toBe('supabase')
  })
  it('確かめられないときは発行しない', async () => {
    state.jobErr = { message: 'x' }
    expect((await call()).status).toBe(503)
  })
  it('店舗の無いエッジには発行しない', async () => {
    state.edge = { id: 'e1', store_id: null }
    expect((await call()).status).toBe(403)
  })
})
