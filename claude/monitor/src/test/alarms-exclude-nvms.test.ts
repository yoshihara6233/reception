import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ALARM の未完了の数が G・VMS の機械の状態 (source='nvms') を数えないことを確かめる。
 * 通知を受け持つ /api/edge/events の記録は残るので、読む側で外す。
 */
const filters: Array<[string, string, unknown]> = []
let user: { id: string } | null = { id: 'u1' }
let scope: { needsTenant: boolean; storeIds: string[] } = { needsTenant: false, storeIds: ['s1', 's2'] }

// 数える範囲は発報タイムラインと同じ店舗 (2026-11-04・シナリオ試験の所見)
vi.mock('@/lib/tenant/monitor-scope', () => ({
  resolveMonitorScope: async () => ({ ctx: {}, tenantId: null, ...scope }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => {
      const q = {
        select: () => q,
        neq: (col: string, val: string) => { filters.push(['neq', col, val]); return q },
        in: (col: string, val: string[]) => { filters.push(['in', col, val]); return q },
        then: (ok: (r: { count: number }) => unknown) => ok({ count: 3 }),
      }
      return q
    },
  }),
}))

describe('GET /api/alarms/open-count', () => {
  beforeEach(() => { filters.length = 0; user = { id: 'u1' }; scope = { needsTenant: false, storeIds: ['s1', 's2'] } })

  it('完了と source=nvms を除いて数える', async () => {
    const { GET } = await import('@/app/api/alarms/open-count/route')
    const res = await GET()
    expect(await res.json()).toEqual({ count: 3 })
    expect(filters).toContainEqual(['neq', 'status', 'closed'])
    expect(filters).toContainEqual(['neq', 'source', 'nvms'])
    expect(filters).toContainEqual(['in', 'store_id', ['s1', 's2']])
  })

  it('テナント未選択 (タイムラインはテナントの選択を求める) は数えずに 0', async () => {
    scope = { needsTenant: true, storeIds: [] }
    const { GET } = await import('@/app/api/alarms/open-count/route')
    const res = await GET()
    expect(await res.json()).toEqual({ count: 0 })
    expect(filters).toEqual([])
  })
})
