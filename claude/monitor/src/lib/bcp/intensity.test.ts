import { describe, expect, it } from 'vitest'
import { intensityRank, jmaIntensityLabel } from './intensity'

/**
 * 震度の順位付け。**BCP の発動判定はこの順序に全面的に依存する**
 * （しきい値「5強以上」は intensityRank の比較で決まる）。
 *
 * ここは 2026-08-09 の変異テスト導入で見つかった穴。jmaIntensityLabel だけ
 * テストがあり、**intensityRank は 1 件も無かった**。順序表の要素を 1 つ壊しても
 * （'6+' → ''）誰も気づかない状態だったので、全 9 段階を固定する。
 */
describe('intensityRank', () => {
  it('弱い順に 1〜9 を返す（全 9 段階）', () => {
    const order = ['1', '2', '3', '4', '5-', '5+', '6-', '6+', '7']
    expect(order.map(intensityRank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('5弱 < 5強 < 6弱 < 6強（文字列比較では並ばない箇所）', () => {
    expect(intensityRank('5-')).toBeLessThan(intensityRank('5+'))
    expect(intensityRank('5+')).toBeLessThan(intensityRank('6-'))
    expect(intensityRank('6-')).toBeLessThan(intensityRank('6+'))
    expect(intensityRank('6+')).toBeLessThan(intensityRank('7'))
  })

  it('未知・未取得は 0（最弱扱い＝発動しない側に倒す）', () => {
    for (const v of [null, undefined, '', '   ', '8', '5', 'X']) {
      expect(intensityRank(v), `${JSON.stringify(v)} は 0 のはず`).toBe(0)
    }
  })

  it('前後の空白を無視する（XML から取り出した生値がそのまま来る）', () => {
    expect(intensityRank(' 5+ ')).toBe(intensityRank('5+'))
  })

  it('しきい値「5強以上」が意図どおりに切れる', () => {
    // 発動条件そのものの形。境界を跨ぐ 2 値を必ず含める。
    const threshold = intensityRank('5+')
    expect(intensityRank('5-')).toBeLessThan(threshold)   // 発動しない
    expect(intensityRank('5+')).toBeGreaterThanOrEqual(threshold)  // 発動する
    expect(intensityRank('6-')).toBeGreaterThanOrEqual(threshold)
  })
})

describe('jmaIntensityLabel', () => {
  it('JMA MaxInt 生値を日本語表記にする', () => {
    expect(jmaIntensityLabel('3')).toBe('震度3')
    expect(jmaIntensityLabel('5-')).toBe('震度5弱')
    expect(jmaIntensityLabel('5+')).toBe('震度5強')
    expect(jmaIntensityLabel('6-')).toBe('震度6弱')
    expect(jmaIntensityLabel('6+')).toBe('震度6強')
    expect(jmaIntensityLabel('7')).toBe('震度7')
  })

  it('null/未設定（津波・ミサイル等）は null', () => {
    expect(jmaIntensityLabel(null)).toBeNull()
    expect(jmaIntensityLabel(undefined)).toBeNull()
    expect(jmaIntensityLabel('')).toBeNull()
    expect(jmaIntensityLabel('  ')).toBeNull()
  })

  it('未知の値は生値のまま返す（将来の表記追加に安全側）', () => {
    expect(jmaIntensityLabel('8')).toBe('8')
  })
})
