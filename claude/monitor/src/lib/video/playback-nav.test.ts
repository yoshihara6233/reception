import { describe, expect, it } from 'vitest'
import { fromJstInput, isLiveEdge, liveHref, resumeRange, toJstInput, vodHref } from './playback-nav'

describe('JST の入力欄との変換', () => {
  it('ISO を JST の datetime-local に直し、戻すと同じ時刻になる', () => {
    const iso = '2026-09-25T19:54:00.000Z'
    expect(toJstInput(iso)).toBe('2026-09-26T04:54:00')
    expect(fromJstInput('2026-09-26T04:54:00')).toBe(iso)
  })
  it('秒の無い入力も読める・読めない値は null', () => {
    expect(fromJstInput('2026-09-26T04:54')).toBe('2026-09-25T19:54:00.000Z')
    expect(fromJstInput('')).toBeNull()
  })
})

describe('ライブで見る範囲か', () => {
  const now = Date.parse('2026-09-25T20:00:00Z')
  it('30 秒前は録画で開く', () => {
    expect(isLiveEdge('2026-09-25T19:59:30Z', now)).toBe(false)
  })
  it('今の 5 秒以内と今より先はライブ', () => {
    expect(isLiveEdge('2026-09-25T19:59:57Z', now)).toBe(true)
    expect(isLiveEdge('2026-09-25T20:04:30Z', now)).toBe(true)
  })
})

describe('行き先', () => {
  it('開始時刻だけで開けるカメラは from だけ付ける', () => {
    expect(vodHref('s1', 'c1', '2026-09-25T19:55:00.000Z', null))
      .toBe('/stores/s1/cam/c1/vod?from=2026-09-25T19%3A55%3A00.000Z')
  })
  it('範囲の切り出しのカメラは to も付ける', () => {
    expect(vodHref('s1', 'c1', '2026-09-25T19:55:00.000Z', 5))
      .toBe('/stores/s1/cam/c1/vod?from=2026-09-25T19%3A55%3A00.000Z&to=2026-09-25T20%3A00%3A00.000Z')
  })
  it('ライブへ戻る先', () => {
    expect(liveHref('s1', 'c1')).toBe('/stores/s1/cam/c1/live')
  })
})

describe('切れたところから開き直す範囲', () => {
  const range = { from: '2026-09-29T00:00:00.000Z', to: '2026-09-29T01:00:00.000Z' }

  it('最後に映していた録画の時刻から始め、終わりは保つ', () => {
    expect(resumeRange(range, new Date('2026-09-29T00:12:34.000Z')))
      .toEqual({ from: '2026-09-29T00:12:34.000Z', to: '2026-09-29T01:00:00.000Z' })
  })

  it('まだ映していなければ、いまの範囲のまま', () => {
    expect(resumeRange(range, null)).toEqual(range)
    expect(resumeRange(range, new Date(Number.NaN))).toEqual(range)
  })

  it('終わりを過ぎていたら終わりは既定（60 分）に任せる', () => {
    expect(resumeRange(range, new Date('2026-09-29T01:00:00.000Z')))
      .toEqual({ from: '2026-09-29T01:00:00.000Z', to: undefined })
  })

  it('終わりの指定が無ければ無いまま', () => {
    expect(resumeRange({ from: range.from, to: undefined }, new Date('2026-09-29T00:05:00.000Z')))
      .toEqual({ from: '2026-09-29T00:05:00.000Z', to: undefined })
  })
})
