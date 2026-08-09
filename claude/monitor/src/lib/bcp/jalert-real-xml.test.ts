import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  parseAffectedPrefs,
  parseEventId,
  parseMaxIntensity,
  shouldTrigger,
  storeAreaIntensity,
} from '../../../supabase/functions/jalert-poller/match'

/**
 * 気象庁から実際に配信された無加工の XML に対する契約テスト。
 *
 * jalert-match.test.ts の XML は手で切り詰めた抜粋で、抜粋を作った時点で
 * 「関係ない」と判断された構造は入っていない。名前空間・Head の Headline・
 * 震央地名コードなど、実電文にしか無いものでパーサが壊れないことをここで見る。
 *
 * フィクスチャの一覧と取得元は tests/fixtures/jma/README.md を参照。
 */

const dir = fileURLToPath(new URL('../../../tests/fixtures/jma/', import.meta.url))
const load = (name: string) => readFileSync(`${dir}${name}`, 'utf8')

interface Fixture {
  file: string
  kind: string
  eventId: string
  /** JIS 都道府県コード → その県の最大震度。空 = 都道府県を特定できない電文。 */
  prefs: Record<string, string | null>
  /** 電文全体の最大震度（MaxInt の最初の出現）。 */
  maxInt: string | null
}

const FIXTURES: Fixture[] = [
  {
    file: '20260808193442_0_VXSE51_010000.xml',
    kind: '震度速報',
    eventId: '20260809043311',
    prefs: { '43': '3' },
    maxInt: '3',
  },
  {
    file: '20260808193526_0_VXSE52_270000.xml',
    kind: '震源に関する情報',
    eventId: '20260809043311',
    // 震源に関する情報は震央地名(741)しか持たず、都道府県は 1 つも入っていない。
    prefs: {},
    maxInt: null,
  },
  {
    file: '20260808230355_0_VXSE51_010000.xml',
    kind: '震度速報',
    eventId: '20260809080210',
    prefs: { '43': '4', '42': '3' },
    maxInt: '4',
  },
  {
    file: '20260808230440_0_VXSE52_270000.xml',
    kind: '震源に関する情報',
    eventId: '20260809080210',
    prefs: {},
    maxInt: null,
  },
  {
    file: '20260809035317_0_VXSE53_010000.xml',
    kind: '震源・震度情報',
    eventId: '20260809125037',
    prefs: { '43': '1' },
    maxInt: '1',
  },
  {
    file: '20260809050802_0_VXSE53_010000.xml',
    kind: '震源・震度情報',
    eventId: '20260809140518',
    prefs: { '24': '1' },
    maxInt: '1',
  },
]

describe('実電文の解析（tests/fixtures/jma）', () => {
  it.each(FIXTURES)('$kind $file → EventID $eventId', ({ file, eventId }) => {
    expect(parseEventId(load(file))).toBe(eventId)
  })

  it.each(FIXTURES)('$kind $file → 都道府県と震度', ({ file, prefs }) => {
    expect(Object.fromEntries(parseAffectedPrefs(load(file)))).toEqual(prefs)
  })

  it.each(FIXTURES)('$kind $file → 最大震度 $maxInt', ({ file, maxInt }) => {
    expect(parseMaxIntensity(load(file))).toBe(maxInt)
  })
})

describe('同一地震の名寄せ（PR #278 の前提を実データで固定）', () => {
  // 1 つの地震に対し気象庁は複数の電文を出す。Atom の id も updated も電文ごとに
  // 違うので、EventID を鍵にしないと一覧で同じ地震が 2 行に割れる。
  it.each([
    ['20260809043311', ['20260808193442_0_VXSE51_010000.xml', '20260808193526_0_VXSE52_270000.xml']],
    ['20260809080210', ['20260808230355_0_VXSE51_010000.xml', '20260808230440_0_VXSE52_270000.xml']],
  ])('震度速報と震源に関する情報が同じ EventID %s を持つ', (eventId, files) => {
    const got = (files as string[]).map((f) => parseEventId(load(f)))
    expect(got).toEqual([eventId, eventId])
  })

  it('別の地震どうしは EventID が異なる（名寄せしすぎない）', () => {
    const all = FIXTURES.map((f) => parseEventId(load(f.file)))
    expect(new Set(all).size).toBe(4) // 2 組 + 単独 2 件
  })
})

describe('細分区域・震央地名コードを都道府県として使わない', () => {
  // 細分区域も震央地名も 3 桁で、JIS 都道府県(01〜47)とは別体系。
  //
  // 危険度には 2 段階ある。
  //   ① 先頭2桁が JIS 範囲外（741→"74"、732→"73"）: isJisPref が弾くので実害が出ない。
  //   ② 先頭2桁が JIS 範囲内（462→"46" 鹿児島県、210→"21" 岐阜県）: **実在の県に化ける**。
  // 2026-08-09 の 38 店舗誤発動は②で起きた。①だけを見て「大丈夫」と言えないので、
  // 実電文に含まれる②のケースを名指しで固定する。
  it('462 三重県南部 が "46"（鹿児島県）に化けない ― 実在の県に化ける唯一の実例', () => {
    const prefs = parseAffectedPrefs(load('20260809050802_0_VXSE53_010000.xml'))
    expect(prefs.has('46')).toBe(false)
    expect([...prefs.keys()]).toEqual(['24']) // City 2420900 尾鷲市 由来の三重県だけ
  })

  it.each([
    ['20260808230355_0_VXSE51_010000.xml', '74', '743 熊本県天草・芦北'],
    ['20260808193442_0_VXSE51_010000.xml', '74', '741 熊本県熊本'],
    ['20260808230355_0_VXSE51_010000.xml', '73', '732 長崎県島原半島'],
  ])('%s に %s は現れない（%s ・JIS範囲外なので isJisPref が弾く層）', (file, bogusPref) => {
    expect(parseAffectedPrefs(load(file)).has(bogusPref)).toBe(false)
  })

  it('震源に関する情報は震央地名しか無いので都道府県ゼロ＝店舗は一致しない', () => {
    // ここで空を返さないと、震源に関する情報だけで全国の店舗が発動しうる。
    const prefs = parseAffectedPrefs(load('20260808193526_0_VXSE52_270000.xml'))
    expect(prefs.size).toBe(0)
    for (const store of ['43100', '42201', '01100']) {
      expect(storeAreaIntensity(store, prefs).matched).toBe(false)
    }
  })

  it('Head の Headline にある Area コードを拾わない', () => {
    // 震度速報の Head には「震度4: 743 / 震度3: 732」という別の Area ブロックがある。
    // Body の観測データと二重に数えたり、3桁を県に化かしたりしていないことの確認。
    const prefs = parseAffectedPrefs(load('20260808230355_0_VXSE51_010000.xml'))
    expect([...prefs.keys()].sort()).toEqual(['42', '43'])
  })
})

describe('店舗の発動判定（県ごとの震度を使う）', () => {
  // 熊本=震度4 / 長崎=震度3 の実電文。全国最大値(4)を全店舗に当てると
  // しきい値4の長崎の店舗まで発動する（38店舗誤発動の原因の片方）。
  const prefs = parseAffectedPrefs(load('20260808230355_0_VXSE51_010000.xml'))
  const settings = { quake_min_intensity: '4', tsunami_enabled: true, missile_enabled: true }

  it('熊本市の店舗は震度4で発動する', () => {
    const hit = storeAreaIntensity('43100', prefs)
    expect(hit).toEqual({ matched: true, intensity: '4' })
    expect(shouldTrigger('earthquake', hit.intensity, settings)).toBe(true)
  })

  it('長崎市の店舗は震度3なのでしきい値4では発動しない', () => {
    const hit = storeAreaIntensity('42201', prefs)
    expect(hit).toEqual({ matched: true, intensity: '3' })
    expect(shouldTrigger('earthquake', hit.intensity, settings)).toBe(false)
    // しきい値を3に下げれば発動する（震度が取れていないわけではないことの確認）
    expect(shouldTrigger('earthquake', hit.intensity, { ...settings, quake_min_intensity: '3' })).toBe(true)
  })

  it('揺れていない県の店舗は一致しない', () => {
    for (const store of ['13101', '27100', '01100']) {
      expect(storeAreaIntensity(store, prefs).matched).toBe(false)
    }
  })

  it('市区町村コード7桁の店舗でも先頭2桁で一致する', () => {
    // stores.area_code は JIS 市区町村コード。5桁(43100)でも7桁でも先頭2桁で引く。
    expect(storeAreaIntensity('4310300', prefs).matched).toBe(true)
  })
})
