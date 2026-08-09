import { describe, expect, it } from 'vitest'
import {
  intensityRank,
  parseAffectedPrefs,
  parseAreaCodes,
  parseEventId,
  parseMaxIntensity,
  shouldTrigger,
  storeAreaIntensity,
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

describe('storeAreaIntensity（エリア照合）', () => {
  const prefs53 = parseAffectedPrefs(VXSE53_KUMAMOTO)
  const prefs51 = parseAffectedPrefs(VXSE51_KUMAMOTO)

  it('JIS コードの熊本市店舗は震源・震度情報/震度速報の両方に一致する（2026-07-31 回帰の本丸）', () => {
    expect(storeAreaIntensity('43100', prefs53).matched).toBe(true) // 熊本市
    expect(storeAreaIntensity('43103', prefs53).matched).toBe(true) // 熊本市西区
    expect(storeAreaIntensity('43100', prefs51).matched).toBe(true) // 震度速報でも都道府県一致
  })

  it("旧 'JP-xx' 擬似コードは一致しない（発動しなかった当時の状態）", () => {
    expect(storeAreaIntensity('JP-PoC', prefs53).matched).toBe(false)
    expect(storeAreaIntensity('JP-43', prefs53).matched).toBe(false)
  })

  it('他県の店舗は一致しない', () => {
    expect(storeAreaIntensity('27100', prefs53).matched).toBe(false) // 大阪市
    expect(storeAreaIntensity('01100', prefs51).matched).toBe(false) // 札幌市
  })

  it('area_code 未設定・発令エリア空は一致しない', () => {
    expect(storeAreaIntensity(null, prefs53).matched).toBe(false)
    expect(storeAreaIntensity('43100', new Map()).matched).toBe(false)
  })

  it('一致した店舗にはその県の観測震度が返る', () => {
    expect(storeAreaIntensity('43100', prefs53).intensity).toBe('3')
  })
})

/**
 * 2026-08-09 03:02 岩手県沖・最大震度4（20260808180207_0_VXSE53_010000.xml の抜粋）。
 *
 * 実際に揺れたのは 7 県だが、旧実装は 19 県・38 店舗を発動させた。原因は 2 つ:
 *   1. 3桁の細分区域コードから先頭2桁を取り、JIS 都道府県として扱っていた
 *      （210 岩手県沿岸北部 → "21" 岐阜県 / 251 福島県浜通り → "25" 滋賀県 …）
 *   2. 震度が電文全体の最大値(4)のまま全店舗に適用され、震度1の県も発動した
 * 以下はその両方に対する回帰テスト。
 */
const VXSE53_IWATE = `<Report><Body><Earthquake><Hypocenter><Area>
<Name>岩手県沖</Name><Code type="震央地名">210</Code>
</Area></Hypocenter></Earthquake><Intensity><Observation><MaxInt>4</MaxInt>
<Pref><Name>岩手県</Name><Code>03</Code><MaxInt>4</MaxInt><Area><Name>岩手県沿岸北部</Name><Code>210</Code><MaxInt>4</MaxInt><City><Name>普代村</Name><Code>0348500</Code><MaxInt>4</MaxInt></City></Area><Area><Name>岩手県内陸北部</Name><Code>212</Code><MaxInt>3</MaxInt><City><Name>盛岡市</Name><Code>0320100</Code><MaxInt>3</MaxInt></City></Area></Pref>
<Pref><Name>青森県</Name><Code>02</Code><MaxInt>3</MaxInt><Area><Name>青森県津軽北部</Name><Code>200</Code><MaxInt>3</MaxInt><City><Name>青森市</Name><Code>0220100</Code><MaxInt>3</MaxInt></City></Area></Pref>
<Pref><Name>北海道</Name><Code>01</Code><MaxInt>2</MaxInt><Area><Name>渡島地方東部</Name><Code>106</Code><MaxInt>2</MaxInt><City><Name>函館市</Name><Code>0120200</Code><MaxInt>2</MaxInt></City></Area><Area><Name>檜山地方</Name><Code>110</Code><MaxInt>2</MaxInt><City><Name>上ノ国町</Name><Code>0136200</Code><MaxInt>2</MaxInt></City></Area><Area><Name>胆振地方中東部</Name><Code>146</Code><MaxInt>1</MaxInt><City><Name>白老町</Name><Code>0157800</Code><MaxInt>1</MaxInt></City></Area><Area><Name>日高地方中部</Name><Code>151</Code><MaxInt>1</MaxInt><City><Name>新冠町</Name><Code>0160700</Code><MaxInt>1</MaxInt></City></Area></Pref>
<Pref><Name>宮城県</Name><Code>04</Code><MaxInt>2</MaxInt><Area><Name>宮城県北部</Name><Code>220</Code><MaxInt>2</MaxInt><City><Name>気仙沼市</Name><Code>0420500</Code><MaxInt>2</MaxInt></City></Area></Pref>
<Pref><Name>秋田県</Name><Code>05</Code><MaxInt>2</MaxInt><Area><Name>秋田県沿岸北部</Name><Code>230</Code><MaxInt>2</MaxInt><City><Name>三種町</Name><Code>0534800</Code><MaxInt>2</MaxInt></City></Area></Pref>
<Pref><Name>山形県</Name><Code>06</Code><MaxInt>1</MaxInt><Area><Name>山形県庄内</Name><Code>240</Code><MaxInt>1</MaxInt><City><Name>酒田市</Name><Code>0620400</Code><MaxInt>1</MaxInt></City></Area></Pref>
<Pref><Name>福島県</Name><Code>07</Code><MaxInt>1</MaxInt><Area><Name>福島県浜通り</Name><Code>251</Code><MaxInt>1</MaxInt><City><Name>浪江町</Name><Code>0754700</Code><MaxInt>1</MaxInt></City></Area></Pref>
</Observation></Intensity></Body></Report>`

describe('2026-08-09 岩手県沖 震度4（38店舗誤発動の回帰）', () => {
  const prefs = parseAffectedPrefs(VXSE53_IWATE)

  it('揺れた 7 県だけを抽出し、県ごとの震度を持つ', () => {
    expect([...prefs.keys()].sort()).toEqual(['01', '02', '03', '04', '05', '06', '07'])
    expect(prefs.get('03')).toBe('4') // 岩手県
    expect(prefs.get('02')).toBe('3') // 青森県
    expect(prefs.get('07')).toBe('1') // 福島県
  })

  it.each([
    ['21201', '岐阜県',   '210 岩手県沿岸北部'],
    ['25201', '滋賀県',   '251 福島県浜通り'],
    ['22201', '静岡県',   '220 宮城県北部'],
    ['23100', '愛知県',   '230 秋田県沿岸北部'],
    ['14100', '神奈川県', '146 胆振地方中東部'],
    ['15100', '新潟県',   '151 日高地方中部'],
    ['11100', '埼玉県',   '110 檜山地方'],
    ['20201', '長野県',   '200 青森県津軽北部'],
    ['24201', '三重県',   '240 山形県庄内'],
  ])('細分区域コードによる誤爆が起きない: %s %s（旧実装は %s に引きずられた）', (code) => {
    expect(storeAreaIntensity(code, prefs).matched).toBe(false)
  })

  it('震度は全国最大値ではなく、その店舗の県の値で判定する', () => {
    const settings = { quake_min_intensity: '4', tsunami_enabled: true, missile_enabled: true }
    const iwate     = storeAreaIntensity('03201', prefs) // 岩手県 → 震度4
    const fukushima = storeAreaIntensity('07201', prefs) // 福島県 → 震度1

    expect(iwate.intensity).toBe('4')
    expect(fukushima.intensity).toBe('1')
    expect(shouldTrigger('earthquake', iwate.intensity, settings)).toBe(true)
    // 旧実装はここに全国最大の '4' を渡していたため、震度1の福島も発動していた
    expect(shouldTrigger('earthquake', fukushima.intensity, settings)).toBe(false)
  })

  it('震源の細分区域コード(210)だけでは都道府県を作らない', () => {
    expect(prefs.has('21')).toBe(false)
  })
})

describe('parseAffectedPrefs の境界', () => {
  it('津波電文のように都道府県コードが無ければ空を返す（呼び出し側で安全側に倒す）', () => {
    const tsunami = `<Report><Body><Warning><Item>
<Area><Name>宮城県</Name><Code>222</Code></Area></Item></Warning></Body></Report>`
    expect(parseAffectedPrefs(tsunami).size).toBe(0)
  })

  it('JIS 範囲外の 2 桁コード(48〜)は都道府県として採用しない', () => {
    const bogus = `<Report><Pref><Name>?</Name><Code>48</Code><MaxInt>5-</MaxInt></Pref></Report>`
    expect(parseAffectedPrefs(bogus).size).toBe(0)
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

describe('parseEventId（同一地震の名寄せ）', () => {
  it('Head の EventID を取り出す', () => {
    const xml = `<Report><Head><Title>震度速報</Title><EventID>20260809025805</EventID></Head></Report>`
    expect(parseEventId(xml)).toBe('20260809025805')
  })

  it('名前空間つきタグでも取れる', () => {
    expect(parseEventId('<jmx:EventID>20260801024900</jmx:EventID>')).toBe('20260801024900')
  })

  it('EventID が無い電文は null（呼び出し側は時間窓へフォールバックする）', () => {
    expect(parseEventId('<Report><Head><Title>津波注意報</Title></Head></Report>')).toBeNull()
    expect(parseEventId('<Report><Head><EventID></EventID></Head></Report>')).toBeNull()
  })

  it('同一地震の 4 電文は同じ EventID を返す（2026-08-09 岩手県沖の実配信）', () => {
    const ids = ['震度速報', '震度速報(続報)', '震源に関する情報', '震源・震度に関する情報']
      .map((t) => parseEventId(`<Report><Head><Title>${t}</Title><EventID>20260809025805</EventID></Head></Report>`))
    expect(new Set(ids).size).toBe(1)
  })
})
