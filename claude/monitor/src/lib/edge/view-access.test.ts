import { beforeEach, describe, expect, it } from 'vitest'
import {
  VIEW_ACCESS_TTL_MS,
  readViewAccess,
  writeViewAccess,
  resetViewAccessCache,
  resolveEdgeVisibility,
  type EdgeVisibilityClient,
} from './view-access'

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'
const E1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const E2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** `.from().select().eq().maybeSingle()` だけを満たす最小のダブル。 */
function fakeClient(result: { data: { id: string } | null; error: unknown }): EdgeVisibilityClient {
  return {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
  }
}

describe('可視性キャッシュ', () => {
  beforeEach(() => resetViewAccessCache())

  it('未記録は undefined（＝呼び出し側に DB を引かせる）', () => {
    expect(readViewAccess(U1, E1, 0)).toBeUndefined()
  })

  it('書いた判定を TTL 内は返す', () => {
    writeViewAccess(U1, E1, true, 0)
    expect(readViewAccess(U1, E1, VIEW_ACCESS_TTL_MS - 1)).toBe(true)
  })

  it('TTL 到達で失効する（権限剥奪が最大 TTL 遅れで効く）', () => {
    writeViewAccess(U1, E1, true, 0)
    expect(readViewAccess(U1, E1, VIEW_ACCESS_TTL_MS)).toBeUndefined()
  })

  it('拒否も覚える（他テナントの総当たりで毎回 DB を引かせない）', () => {
    writeViewAccess(U1, E1, false, 0)
    expect(readViewAccess(U1, E1, 0)).toBe(false)
  })

  it('★利用者が違えば共有しない', () => {
    writeViewAccess(U1, E1, true, 0)
    expect(readViewAccess(U2, E1, 0)).toBeUndefined()
  })

  it('★エッジが違えば共有しない', () => {
    writeViewAccess(U1, E1, true, 0)
    expect(readViewAccess(U1, E2, 0)).toBeUndefined()
  })
})

describe('resolveEdgeVisibility', () => {
  it('RLS 配下で行が引ければ visible', async () => {
    const supa = fakeClient({ data: { id: E1 }, error: null })
    expect(await resolveEdgeVisibility(supa, E1)).toBe('visible')
  })

  it('★0行は hidden — 他テナントのエッジは RLS で消えるので、これが認可判定そのもの', async () => {
    const supa = fakeClient({ data: null, error: null })
    expect(await resolveEdgeVisibility(supa, E1)).toBe('hidden')
  })

  it('エラーは hidden と区別して error（キャッシュさせないため）', async () => {
    // 不正な UUID や DB 瞬断。false を 30 秒覚え込むと正当な利用者が締め出される。
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
