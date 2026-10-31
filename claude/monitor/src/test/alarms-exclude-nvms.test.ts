import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ALARM の未完了の数が G・VMS の機械の状態 (source='nvms') を数えないことを確かめる。
 * 通知を受け持つ /api/edge/events の記録は残るので、読む側で外す。
 */
const filters: Array<[string, string, string]> = []
let user: { id: string } | null = { id: 'u1' }

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => {
      const q = {
        select: () => q,
        neq: (col: string, val: string) => { filters.push(['neq', col, val]); return q },
        then: (ok: (r: { count: number }) => unknown) => ok({ count: 3 }),
      }
      return q
    },
  }),
}))

describe('GET /api/alarms/open-count', () => {
  beforeEach(() => { filters.length = 0; user = { id: 'u1' } })

  it('完了と source=nvms を除いて数える', async () => {
    const { GET } = await import('@/app/api/alarms/open-count/route')
    const res = await GET()
    expect(await res.json()).toEqual({ count: 3 })
    expect(filters).toContainEqual(['neq', 'status', 'closed'])
    expect(filters).toContainEqual(['neq', 'source', 'nvms'])
  })
})
