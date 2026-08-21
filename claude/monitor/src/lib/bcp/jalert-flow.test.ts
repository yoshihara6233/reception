import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  classifyAlertType,
  extractTag,
  isRelevantEntry,
  isWeatherWarningEntry,
  hasNoTargetPref,
  mergeFeedEntries,
  parseFeedEntries,
  type FeedEntry,
} from '../../../supabase/functions/jalert-poller/flow'

/**
 * jalert-poller の「流れ」——フィード解析・絞り込み・対象範囲の決定。
 *
 * ── なぜ必要だったか ────────────────────────────────────────────────────
 * 照合ロジック（match.ts）は実配信 XML 6 本で固定済みだったが、**その手前の
 * 「何を処理対象にするか」は一切テストが無かった**。誤発報が起きたのは
 * まさにこの領域で、原因も 2 回ともここにある:
 *
 *   ・旧 `RELEVANT_TYPES=['VPWW54','VXSE51']` … VPWW54 は津波ではなく
 *     **気象警報・注意報**。平常時の気象警報が大量に混入した
 *   ・3 桁の津波予報区コードから先頭 2 桁を都道府県として使った
 *     … 462 → 46（鹿児島県）。**38 店舗へ誤発報**
 *
 * ── フィクスチャ ────────────────────────────────────────────────────────
 * `feed-eqvol-20260809.xml` は気象庁 eqvol.xml の実配信（無加工）。
 * **38 エントリ中 32 件が「降灰予報（定時）」** で、平常時のフィードは
 * 大半が無関係な情報という実態がそのまま入っている。
 * 通す条件より**落とす件数**が効いていることを、この実データで固定する。
 */

const FEED = readFileSync(
  fileURLToPath(new URL('../../../tests/fixtures/jma/feed-eqvol-20260809.xml', import.meta.url)),
  'utf8',
)

const entry = (over: Partial<FeedEntry> = {}): FeedEntry =>
  ({ id: 'urn:uuid:1', title: '', updated: '', linkHref: '', ...over })

describe('parseFeedEntries（実配信 Atom）', () => {
  const parsed = parseFeedEntries(FEED)

  it('38 エントリを取り出す', () => {
    expect(parsed).toHaveLength(38)
  })

  it('★フィード自体のタイトルを entry として拾わない', () => {
    // 先頭に <title>高頻度（地震火山）</title> がある。これを拾うと「地震」を
    // 含むため関連ありと誤判定され、毎分ぶんの偽エントリが流れ込む。
    expect(parsed.map((e) => e.title)).not.toContain('高頻度（地震火山）')
  })

  it('id・title・updated・link をすべて埋める', () => {
    for (const e of parsed) {
      expect(e.id, 'id が空です').toBeTruthy()
      expect(e.title, `${e.id} の title が空です`).toBeTruthy()
      expect(e.updated, `${e.id} の updated が空です`).toBeTruthy()
      expect(e.linkHref, `${e.id} の link が空です`).toMatch(/^https?:\/\//)
    }
  })

  it('id が全件ユニーク（名寄せの鍵として使える）', () => {
    expect(new Set(parsed.map((e) => e.id)).size).toBe(parsed.length)
  })

  it('id が無い entry は捨てる（名寄せできないため）', () => {
    const xml = '<feed><entry><title>震度速報</title></entry></feed>'
    expect(parseFeedEntries(xml)).toEqual([])
  })

  it('entry が 1 つも無いフィードは空配列', () => {
    expect(parseFeedEntries('<feed><title>地震火山</title></feed>')).toEqual([])
  })

  it('link の rel 属性有無どちらでも href を取る', () => {
    const withRel = '<feed><entry><id>a</id><link rel="alternate" href="https://x/1"/></entry></feed>'
    const bare    = '<feed><entry><id>b</id><link href="https://x/2"/></entry></feed>'
    expect(parseFeedEntries(withRel)[0].linkHref).toBe('https://x/1')
    expect(parseFeedEntries(bare)[0].linkHref).toBe('https://x/2')
  })
})

describe('extractTag', () => {
  it('最初の一致を返し、前後の空白を落とす', () => {
    expect(extractTag('<title>  震度速報  </title><title>別</title>', 'title')).toBe('震度速報')
  })

  it('属性つきのタグでも取れる', () => {
    expect(extractTag('<title type="text">津波注意報</title>', 'title')).toBe('津波注意報')
  })

  it('無ければ null', () => {
    expect(extractTag('<feed></feed>', 'title')).toBeNull()
  })
})

describe('mergeFeedEntries（複数フィードの名寄せ）', () => {
  const feedA = '<feed><entry><id>same</id><title>震度速報</title></entry></feed>'
  const feedB = '<feed><entry><id>same</id><title>震度速報(B)</title></entry>'
               + '<entry><id>only-b</id><title>津波注意報</title></entry></feed>'

  it('同じ id は 1 件に畳む', () => {
    expect(mergeFeedEntries([feedA, feedB]).map((e) => e.id)).toEqual(['same', 'only-b'])
  })

  it('先に現れたほうを残す', () => {
    expect(mergeFeedEntries([feedA, feedB])[0].title).toBe('震度速報')
  })

  it('★1 本のフィードが落ちても他を止めない', () => {
    // fetchFeed は失敗時に null を返す。地震は eqvol.xml にしか無いので、
    // extra.xml が落ちたくらいで全体を止めてはいけない。
    //
    // 補足: 実装の `if (!xml) continue` を外しても、この検査は通る。
    // RegExp.exec(null) は null を文字列 "null" に強制変換するだけで例外を
    // 投げず、そこに <entry> は無いため結果が変わらないため（等価変異）。
    // **ガードは防御的な記述であって挙動を担っていない。** 変異が生き残るのが
    // 正しく、無理に殺そうとしないこと。
    expect(mergeFeedEntries([null, feedB]).map((e) => e.id)).toEqual(['same', 'only-b'])
  })

  it('全部落ちれば空配列（例外にしない）', () => {
    expect(mergeFeedEntries([null, null])).toEqual([])
  })
})

describe('isRelevantEntry（絞り込み）', () => {
  const parsed = parseFeedEntries(FEED)
  const relevant = parsed.filter(isRelevantEntry)

  it('★実配信 38 件のうち通るのは地震の 6 件だけ', () => {
    expect(relevant).toHaveLength(6)
    expect(new Set(relevant.map((e) => e.title))).toEqual(new Set(['震源・震度に関する情報']))
  })

  it('★降灰予報 32 件をすべて落とす（平常時の大半がこれ）', () => {
    const dropped = parsed.filter((e) => !isRelevantEntry(e))
    expect(dropped).toHaveLength(32)
    expect(dropped.every((e) => e.title.includes('降灰予報'))).toBe(true)
  })

  it('地震の各種タイトルを通す', () => {
    for (const t of ['震度速報', '緊急地震速報（警報）', '震源・震度に関する情報', '地震情報']) {
      expect(isRelevantEntry(entry({ title: t })), t).toBe(true)
    }
  })

  it('気象警報電文（特別警報の入れ物）を通す', () => {
    // 中身が雷注意報だけでも、本文を読むまでは分からないので通す。
    expect(isRelevantEntry(entry({ title: '気象特別警報・警報・注意報' }))).toBe(true)
    expect(isWeatherWarningEntry(entry({ title: '気象特別警報・警報・注意報' }))).toBe(true)
  })

  it('★非対応にした津波・ミサイルは落とす', () => {
    // 2026-08-21 に対象外とした。ここが true に戻ると、都道府県を絞れない
    // 電文が全店フォールバックへ流れる経路が復活する。
    for (const t of ['津波注意報', '津波警報・注意報・予報', '弾道ミサイル情報', '国民保護情報']) {
      expect(isRelevantEntry(entry({ title: t })), t).toBe(false)
    }
  })

  it('★旧書式の気象警報・注意報は落とす（特別警報が入らない電文）', () => {
    // VPWW54「気象警報・注意報（Ｈ２７）」など。VPWW53 と同じ内容が別書式で
    // 流れてくるので、両方通すと同じ発表を二度処理することになる。
    for (const t of ['気象警報・注意報', '気象警報・注意報（Ｈ２７）', '大雨警報', '記録的短時間大雨情報']) {
      expect(isRelevantEntry(entry({ title: t })), t).toBe(false)
    }
  })

  it('噴火・降灰は落とす', () => {
    for (const t of ['噴火警報・予報', '降灰予報（定時）', '火山の状況に関する解説情報']) {
      expect(isRelevantEntry(entry({ title: t })), t).toBe(false)
    }
  })

  it('タイトルが空なら落とす', () => {
    expect(isRelevantEntry(entry({ title: '' }))).toBe(false)
  })
})

describe('classifyAlertType', () => {
  it('地震と気象警報を分類する', () => {
    expect(classifyAlertType('震度速報')).toBe('earthquake')
    expect(classifyAlertType('震源・震度に関する情報')).toBe('earthquake')
    expect(classifyAlertType('気象特別警報・警報・注意報')).toBe('special_warning')
  })

  it('非対応の津波・ミサイルは既知種別に落とさない（生タイトルのまま）', () => {
    expect(classifyAlertType('津波注意報')).toBe('津波注意報')
    expect(classifyAlertType('弾道ミサイル情報')).toBe('弾道ミサイル情報')
  })

  it('「津波」を含む地震電文は earthquake として扱う', () => {
    // 「遠地地震に関する情報（津波の心配なし）」のように両方含む電文がある。
    expect(classifyAlertType('遠地地震に関する情報（津波なし）')).toBe('earthquake')
  })

  it('未知のタイトルは 50 文字に切って返す（捨てない）', () => {
    const long = 'あ'.repeat(80)
    expect(classifyAlertType(long)).toHaveLength(50)
  })

  it('実配信の関連エントリはすべて earthquake に分類される', () => {
    const types = parseFeedEntries(FEED).filter(isRelevantEntry).map((e) => classifyAlertType(e.title))
    expect(new Set(types)).toEqual(new Set(['earthquake']))
  })
})

describe('hasNoTargetPref（都道府県が取れないとき）', () => {
  it('都道府県が取れていれば対象あり', () => {
    expect(hasNoTargetPref(new Map([['43', '5+']]))).toBe(false)
  })

  it('★取れなければ対象なし（全店フォールバックは廃止）', () => {
    // 旧 resolveAreaScope は津波・ミサイルだけ「全有効店舗」に倒していた。
    // 津波・ミサイルの非対応化と一緒に廃止。残る 2 種別（地震・特別警報）は
    // どちらも都道府県を導出できるので、取れないのは電文の異常。
    expect(hasNoTargetPref(new Map())).toBe(true)
  })
})
