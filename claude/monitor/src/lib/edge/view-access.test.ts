import { describe, expect, it } from 'vitest'
import {
  resolveEdgeVisibility,
  toAccess,
  type EdgeVisibilityClient,
} from './view-access'

const U1 = '11111111-1111-4111-8111-111111111111'
const E1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/** `.from().select().eq().maybeSingle()` だけを満たす最小のダブル。 */
function fakeClient(result: { data: { id: string } | null; error: unknown }): EdgeVisibilityClient {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
  }
}

describe('resolveEdgeVisibility', () => {
  it('RLS 配下で行が引ければ visible', async () => {
    expect(await resolveEdgeVisibility(fakeClient({ data: { id: E1 }, error: null }), E1)).toBe('visible')
  })

  it('★0行は hidden — 他テナントのエッジは RLS で消えるので、これが認可判定そのもの', async () => {
    expect(await resolveEdgeVisibility(fakeClient({ data: null, error: null }), E1)).toBe('hidden')
  })

  it('エラーは hidden と区別して error（キャッシュさせないため）', async () => {
    // 不正な UUID や DB 瞬断。false を30秒覚え込むと正当な利用者が締め出される。
    const supa = fakeClient({ data: null, error: { message: 'invalid input syntax for type uuid' } })
    expect(await resolveEdgeVisibility(supa, 'not-a-uuid')).toBe('error')
  })

  it('例外が飛んでも error に丸める（フェイルクローズ）', async () => {
    const supa = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => { throw new Error('boom') } }) }) }),
    } as unknown as EdgeVisibilityClient
    expect(await resolveEdgeVisibility(supa, E1)).toBe('error')
  })
})

describe('toAccess（キャッシュ済み判定 → HTTP 応答）', () => {
  it('検証済み＋可視 → 通す', () => {
    expect(toAccess({ userId: U1, ok: true })).toEqual({ ok: true, userId: U1 })
  })

  it('検証済みだが可視外 → 403（ログイン自体は有効なので 401 にしない）', () => {
    expect(toAccess({ userId: U1, ok: false })).toEqual({ ok: false, status: 403 })
  })

  it('★トークン無効 → 401（ok の値によらず必ず 401）', () => {
    expect(toAccess({ userId: null, ok: false })).toEqual({ ok: false, status: 401 })
    expect(toAccess({ userId: null, ok: true })).toEqual({ ok: false, status: 401 })
  })
})
