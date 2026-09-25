import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  updates: [] as Record<string, unknown>[],
  /** 名乗りの列が無い DB（migration 前）を真似る */
  noAnnounceColumns: false,
}))

vi.mock('@/lib/edge/device-auth', () => ({
  authenticateEdge: async () => ({ id: 'edge-1', store_id: 'store-1' }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseService: () => ({
    from: () => ({
      update: (p: Record<string, unknown>) => {
        h.updates.push(p)
        const missing = h.noAnnounceColumns && 'capabilities' in p
        return { eq: async () => ({ error: missing ? { code: 'PGRST204', message: "Could not find the 'capabilities' column" } : null }) }
      },
    }),
  }),
}))

import { POST } from './route'

const post = (body: unknown) => POST(new NextRequest('http://localhost/api/edge/heartbeat', {
  method: 'POST', body: JSON.stringify(body), headers: { authorization: 'Bearer t' },
}))

beforeEach(() => { h.updates = []; h.noAnnounceColumns = false })

describe('POST /api/edge/heartbeat — 版と機能の名乗り（GVMS_CLOUD_SPEC §2）', () => {
  it('名乗りと遠隔視聴の状況を写す', async () => {
    const res = await post({
      status: 'idle', agent_version: 'nvmsd/0.1.68', spec_version: 1,
      capabilities: ['grid', 'hls_live', 'hls_vod'], video: { sessions: 2, kbps: 1650 },
    })
    expect(res.status).toBe(204)
    expect(h.updates[0]).toMatchObject({
      spec_version: 1, capabilities: ['grid', 'hls_live', 'hls_vod'], video_sessions_now: 2, video_kbps: 1650,
    })
  })

  it('★知らない機能名を名乗っても拒否しない（§7-7）', async () => {
    const res = await post({ status: 'idle', capabilities: ['grid', 'teleport_v9'] })
    expect(res.status).toBe(204)
    expect(h.updates[0].capabilities).toEqual(['grid', 'teleport_v9'])
  })

  it('★名乗りが崩れていても死活は落とさない（読めた分だけ使う）', async () => {
    const res = await post({ status: 'idle', spec_version: 'v1', capabilities: ['ok', 42, 'NG!'], video: 'x' })
    expect(res.status).toBe(204)
    expect(h.updates[0]).toMatchObject({ spec_version: null, capabilities: ['ok'], video_sessions_now: 0 })
    expect(h.updates[0].last_seen_at).toBeTruthy()
  })

  it('名乗りの無い拠点（0.1.67 以前へ戻した場合も）は null に戻す', async () => {
    await post({ status: 'idle', agent_version: 'nvmsd/0.1.67' })
    expect(h.updates[0]).toMatchObject({ spec_version: null, capabilities: null })
  })

  it('★名乗りの列がまだ無い DB でも死活は落とさない（migration 前のデプロイ）', async () => {
    h.noAnnounceColumns = true
    const res = await post({ status: 'idle', agent_version: 'nvmsd/0.1.68', capabilities: ['hls_live'] })
    expect(res.status).toBe(204)
    expect(h.updates).toHaveLength(2)
    expect(h.updates[1]).not.toHaveProperty('capabilities')
    expect(h.updates[1]).toMatchObject({ status: 'idle', agent_version: 'nvmsd/0.1.68' })
  })
})
