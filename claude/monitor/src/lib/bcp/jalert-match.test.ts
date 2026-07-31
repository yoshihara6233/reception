import { describe, expect, it } from 'vitest'
import {
  intensityRank,
  matchesStoreArea,
  parseAreaCodes,
  parseMaxIntensity,
  shouldTrigger,
} from '../../../supabase/functions/jalert-poller/match'

/**
 * フィクスチャは 2026-07-31 07:50 熊本県熊本地方の実配信 XML の抜粋。
 *   震度速報:       20260730225205_0_VXSE51_270000.xml（City なし・Pref/Area のみ）
 *   震源・震度情報: 20260730225336_0_VXSE53_270000.xml（Pref/Area/City/IntensityStation）
 * この地震（最大震度3・しきい値2以上）で PoC 店舗が発動しなかった回帰の再現。
 */

const VXSE51_KUMAMOTO = `<Report>
<Body>
<Intensity>
<Observation>
<CodeDefine>
<Type xpath="Pref/Code">地震情報／都道府県等</Type>
<Type xpath="Pref/Area/Code">地震情報／細分区域</Type>
</CodeDefine>
<MaxInt>3</MaxInt>
<Pref>
<Name>熊本県</Name><Code>43</Code><MaxInt>3</MaxInt>
<Area><Name>熊本県熊本</Name><Code>741</Code><MaxInt>3</MaxInt></Area>
</Pref>
</Observation>
</Intensity>
</Body>
</Report>`

const VXSE53_KUMAMOTO = `<Report>
<Body>
<Earthquake>
<Hypocenter>
<Area>
<Name>熊本県熊本地方</Name>
<Code type="震央地名">741</Code>
</Area>
</Hypocenter>
</Earthquake>
<Intensity>
<Observation>
<MaxInt>3</MaxInt>
<Pref><Name>熊本県</Name><Code>43</Code><MaxInt>3</MaxInt>
<Area><Name>熊本県熊本</Name><Code>741</Code><MaxInt>3</MaxInt>
<City><Name>氷川町</Name><Code>4346800</Code><MaxInt>3</MaxInt>
<IntensityStation><Name>氷川町島地＊</Name><Code>4346830</Code><Int>3</Int></IntensityStation>
</City>
<City><Name>熊本南区</Name><Code>4310400</Code><MaxInt>2</MaxInt>
<IntensityStation><Name>熊本南区城南町＊</Name><Code>4310432</Code><Int>2</Int></IntensityStation>
</City>
</Area>
</Pref>
</Observation>
</Intensity>
</Body>
</Report>`

describe('parseAreaCodes', () => {
  it('震源・震度情報(VXSE53)から都道府県・細分区域・市町村コードを抽出する', () => {
    const codes = parseAreaCodes(VXSE53_KUMAMOTO)
    expect(codes).toContain('43')      // Pref: 熊本県
    expect(codes).toContain('741')     // Area: 熊本県熊本
    expect(codes).toContain('4346800') // City: 氷川町
    expect(codes).toContain('4310400') // City: 熊本南区
  })

  it('震度速報(VXSE51: City なし)でも都道府県コードが取れる', () => {
    const codes = parseAreaCodes(VXSE51_KUMAMOTO)
    expect(codes).toContain('43')
    expect(codes).toContain('741')
  })
})

describe('parseMaxIntensity', () => {
  it('最上位の MaxInt を返す', () => {
    expect(parseMaxIntensity(VXSE51_KUMAMOTO)).toBe('3')
    expect(parseMaxIntensity(VXSE53_KUMAMOTO)).toBe('3')
  })
})

describe('matchesStoreArea', () => {
  const codes53 = parseAreaCodes(VXSE53_KUMAMOTO)
  const codes51 = parseAreaCodes(VXSE51_KUMAMOTO)

  it('JIS コードの熊本市店舗は震源・震度情報/震度速報の両方に一致する（回帰の本丸）', () => {
    expect(matchesStoreArea('43100', codes53)).toBe(true) // 熊本市
    expect(matchesStoreArea('43103', codes53)).toBe(true) // 熊本市西区
    expect(matchesStoreArea('43100', codes51)).toBe(true) // 震度速報でも都道府県一致
  })

  it("旧 'JP-xx' 擬似コードは一致しない（発動しなかった当時の状態）", () => {
    expect(matchesStoreArea('JP-PoC', codes53)).toBe(false)
    expect(matchesStoreArea('JP-43', codes53)).toBe(false)
  })

  it('他県の店舗は一致しない', () => {
    expect(matchesStoreArea('27100', codes53)).toBe(false) // 大阪市
    expect(matchesStoreArea('01100', codes51)).toBe(false) // 札幌市
  })

  it('area_code 未設定・発令コード空は一致しない', () => {
    expect(matchesStoreArea(null, codes53)).toBe(false)
    expect(matchesStoreArea('43100', [])).toBe(false)
  })
})

describe('intensityRank / shouldTrigger', () => {
  const settings = { quake_min_intensity: '2', tsunami_enabled: true, missile_enabled: true }

  it('震度3 はしきい値2以上で発動する（今回のケース）', () => {
    expect(shouldTrigger('earthquake', '3', settings)).toBe(true)
  })

  it('震度1 はしきい値2未満なので発動しない', () => {
    expect(shouldTrigger('earthquake', '1', settings)).toBe(false)
  })

  it('5弱/5強などの表記を正しく順序づける', () => {
    expect(intensityRank('5-')).toBeLessThan(intensityRank('5+'))
    expect(intensityRank('6+')).toBeLessThan(intensityRank('7'))
    expect(intensityRank(null)).toBe(0)
    expect(shouldTrigger('earthquake', '5+', { ...settings, quake_min_intensity: '5-' })).toBe(true)
  })

  it('津波・ミサイルはそれぞれのフラグに従う', () => {
    expect(shouldTrigger('tsunami', null, settings)).toBe(true)
    expect(shouldTrigger('tsunami', null, { ...settings, tsunami_enabled: false })).toBe(false)
    expect(shouldTrigger('missile', null, { ...settings, missile_enabled: false })).toBe(false)
    expect(shouldTrigger('weather', '3', settings)).toBe(false)
  })
})
