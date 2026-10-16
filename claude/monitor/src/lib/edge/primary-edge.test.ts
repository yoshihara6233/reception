import { describe, expect, it } from 'vitest'
import { pickPrimaryEdge } from './primary-edge'

/**
 * 拠点に複数のエッジがあるときの代表の選び方を固定する (2026-10-16)。
 * 拠点「PoC 熊本店」で、止まった旧エッジが埋め込み取得の先頭に来て、拠点の画面が
 * 止まった方を表示していた。last_seen_at がいちばん新しいものを選ぶ。
 */
describe('pickPrimaryEdge', () => {
  it('空・null・undefined は undefined', () => {
    expect(pickPrimaryEdge([])).toBeUndefined()
    expect(pickPrimaryEdge(null)).toBeUndefined()
    expect(pickPrimaryEdge(undefined)).toBeUndefined()
  })

  it('1 台ならそれを返す (last_seen_at が null でも)', () => {
    const only = { id: 'a', last_seen_at: null }
    expect(pickPrimaryEdge([only])).toBe(only)
  })

  it('止まった旧エッジが先頭でも、最後に通知が届いた方を選ぶ', () => {
    const old = { id: 'old', name: 'PoC Beelink', last_seen_at: '2026-09-01T00:00:00+00:00' }
    const live = { id: 'live', name: '熊本 録画機', last_seen_at: '2026-10-16T03:00:00+00:00' }
    expect(pickPrimaryEdge([old, live])).toBe(live)
    expect(pickPrimaryEdge([live, old])).toBe(live)
  })

  it('last_seen_at が null のものは最後に回す', () => {
    const never = { id: 'a', last_seen_at: null }
    const seen = { id: 'z', last_seen_at: '2026-01-01T00:00:00Z' }
    expect(pickPrimaryEdge([never, seen])).toBe(seen)
    expect(pickPrimaryEdge([seen, never])).toBe(seen)
  })

  it('読めない時刻は null と同じ扱い', () => {
    const broken = { id: 'a', last_seen_at: 'not-a-date' }
    const seen = { id: 'z', last_seen_at: '2026-01-01T00:00:00Z' }
    expect(pickPrimaryEdge([broken, seen])).toBe(seen)
  })

  it('時刻の書き方 (オフセット) が違っても実時刻で比べる', () => {
    // 12:00+09:00 = 03:00Z。04:00Z の方が新しい
    const jst = { id: 'a', last_seen_at: '2026-10-16T12:00:00+09:00' }
    const utc = { id: 'b', last_seen_at: '2026-10-16T04:00:00Z' }
    expect(pickPrimaryEdge([jst, utc])).toBe(utc)
  })

  it('同じ時刻なら id の昇順で決まる (配列の順に左右されない)', () => {
    const t = '2026-10-16T03:00:00Z'
    const b = { id: 'b', last_seen_at: t }
    const a = { id: 'a', last_seen_at: t }
    expect(pickPrimaryEdge([b, a])).toBe(a)
    expect(pickPrimaryEdge([a, b])).toBe(a)
  })

  it('全部 null なら id の昇順', () => {
    const b = { id: 'b', last_seen_at: null }
    const a = { id: 'a', last_seen_at: null }
    expect(pickPrimaryEdge([b, a])).toBe(a)
  })

  it('引数の配列を並べ替えない', () => {
    const list = [
      { id: 'b', last_seen_at: '2026-01-01T00:00:00Z' },
      { id: 'a', last_seen_at: '2026-02-01T00:00:00Z' },
    ]
    const before = list.map((e) => e.id)
    pickPrimaryEdge(list)
    expect(list.map((e) => e.id)).toEqual(before)
  })
})
