import { describe, expect, it } from 'vitest'
import { fromJstInput, isLiveEdge, liveHref, toJstInput, vodHref } from './playback-nav'

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
