import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  parseSpecialWarnings,
  parseWarningItems,
  storeAreaIntensity,
} from '../../../supabase/functions/jalert-poller/match'

/**
 * 気象特別警報（警戒レベル5）の判定。
 *
 * 実電文（VPWW53「気象特別警報・警報・注意報」）を 1 通そのまま置いてある。
 * 特別警報は年に数回しか出ないので、**平常時の電文で誤って発動しないこと**の
 * ほうがテストの主目的になる。発表側は合成 XML で見る。
 */

const dir = fileURLToPath(new URL('../../../tests/fixtures/jma/', import.meta.url))
const OKAYAMA = readFileSync(`${dir}20260821120143_0_VPWW53_330000.xml`, 'utf8')

/** 熊本県に大雨特別警報が出ている電文（VPWW53 の構造をそのまま縮めた合成XML）。 */
const HEAVY_RAIN_KUMAMOTO = `<?xml version="1.0" encoding="UTF-8"?>
<Report xmlns="http://xml.kishou.go.jp/jmaxml1/">
<Control><Title>気象特別警報・警報・注意報</Title></Control>
<Head><Title>熊本県気象警報・注意報</Title><EventID/></Head>
<Body>
<Notice>［危険警報・氾濫特別警報の発表状況］
なし</Notice>
<Warning type="気象警報・注意報（府県予報区等）">
<Item>
<Kind><Name>大雨特別警報</Name><Code>03</Code><Status>発表</Status></Kind>
<Kind><Name>雷注意報</Name><Code>14</Code><Status>継続</Status></Kind>
<Area><Name>熊本県</Name><Code>430000</Code></Area>
</Item>
</Warning>
<Warning type="気象警報・注意報（市町村等）">
<Item>
<Kind><Name>大雨特別警報</Name><Code>03</Code><Status>発表</Status></Kind>
<Area><Name>熊本市</Name><Code>4310000</Code></Area>
</Item>
<Item>
<Kind><Name>雷注意報</Name><Code>14</Code><Status>継続</Status></Kind>
<Area><Name>八代市</Name><Code>4320200</Code></Area>
</Item>
</Warning>
</Body>
</Report>`

describe('平常時の実電文（岡山県 2026-08-21 21:01）', () => {
  it('★本文に「特別警報」の文字があっても、特別警報とは判定しない', () => {
    // VPWW53 の <Notice> には平常時でも必ず
    // 「［危険警報・氾濫特別警報の発表状況］なし」が入る。素朴に文字列一致を
    // 取ると全国すべての気象電文が特別警報として通る（実測 50/50 通）。
    expect(OKAYAMA.includes('特別警報'), '前提が変わった（Notice の定型文が無い）').toBe(true)

    const scan = parseSpecialWarnings(OKAYAMA)
    expect(scan.kinds, '平常時の気象電文で発動します').toEqual([])
    expect(scan.prefs.size).toBe(0)
  })

  it('この電文に入っているのは大雨注意報だけ', () => {
    const kinds = new Set(parseWarningItems(OKAYAMA).map((i) => i.kind))
    expect(kinds).toEqual(new Set(['大雨注意報']))
  })

  it('★同じ種別に継続と解除が混在する（Status を見ないと取り違える）', () => {
    // Body の解除は <Name>大雨注意報</Name><Status>解除</Status> の形で、
    // Name だけ見ると発表中と区別がつかない。
    const rain = parseWarningItems(OKAYAMA).filter((i) => i.kind === '大雨注意報')
    const byStatus = rain.reduce<Record<string, number>>((acc, i) => {
      acc[i.status] = (acc[i.status] ?? 0) + 1
      return acc
    }, {})
    expect(byStatus).toEqual({ '継続': 4, '解除': 2 })
  })

  it('Head の Headline は読まない（Status が無く発表/解除を区別できない）', () => {
    // Head 側には <Name>解除</Name> という別形の Kind も入っている。
    expect(OKAYAMA.includes('<Name>解除</Name>'), '前提が変わった').toBe(true)
    expect(parseWarningItems(OKAYAMA).some((i) => i.kind === '解除')).toBe(false)
    expect(parseWarningItems(OKAYAMA).every((i) => i.status !== '')).toBe(true)
  })
})

describe('特別警報の発表', () => {
  const scan = parseSpecialWarnings(HEAVY_RAIN_KUMAMOTO)

  it('出ている特別警報の種別を取り出す（注意報は混ぜない）', () => {
    expect(scan.kinds).toEqual(['大雨特別警報'])
  })

  it('対象は JIS 都道府県 2 桁（区域コードの先頭2桁）', () => {
    expect([...scan.prefs.keys()]).toEqual(['43'])
  })

  it('その県の店舗が一致する', () => {
    // stores.area_code は JIS 市区町村コード。地震と同じ照合がそのまま効く。
    expect(storeAreaIntensity('43100', scan.prefs).matched).toBe(true)
    expect(storeAreaIntensity('4310300', scan.prefs).matched).toBe(true)
  })

  it('他県の店舗は一致しない（全店フォールバックを使っていない）', () => {
    for (const store of ['13101', '27100', '01100', '42201']) {
      expect(storeAreaIntensity(store, scan.prefs).matched, store).toBe(false)
    }
  })
})

describe('解除・格下げでは発動しない', () => {
  const withKind = (kind: string, status: string) => `<Report><Body>
<Warning><Item><Kind><Name>${kind}</Name><Status>${status}</Status></Kind>
<Area><Name>熊本県</Name><Code>430000</Code></Area></Item></Warning></Body></Report>`

  it('種別ごとの解除（大雨特別警報 / Status=解除）', () => {
    expect(parseSpecialWarnings(withKind('大雨特別警報', '解除')).kinds).toEqual([])
  })

  it('区域まるごとの解除（Name=解除）', () => {
    expect(parseSpecialWarnings(withKind('解除', '解除')).kinds).toEqual([])
  })

  it('Status が無い・知らない値なら発動しない（通す値を並べている）', () => {
    expect(parseSpecialWarnings(withKind('大雨特別警報', '')).kinds).toEqual([])
    expect(parseSpecialWarnings(withKind('大雨特別警報', '未知の状態')).kinds).toEqual([])
  })

  it('継続中は出ているものとして扱う（発表を取り逃しても拾える）', () => {
    expect(parseSpecialWarnings(withKind('暴風特別警報', '継続')).kinds).toEqual(['暴風特別警報'])
  })

  it('警報・注意報（レベル4以下）では発動しない', () => {
    for (const k of ['大雨警報', '大雨危険警報', '暴風警報', '大雨注意報']) {
      expect(parseSpecialWarnings(withKind(k, '発表')).kinds, k).toEqual([])
    }
  })
})

describe('区域コードの体系を取り違えない', () => {
  const withArea = (code: string) => `<Report><Body>
<Warning><Item><Kind><Name>大雨特別警報</Name><Status>発表</Status></Kind>
<Area><Name>?</Name><Code>${code}</Code></Area></Item></Warning></Body></Report>`

  it('★3桁の細分区域コードからは都道府県を作らない', () => {
    // 741「熊本県熊本」や 210「岩手県沿岸北部」は JIS とは別体系。先頭2桁を
    // 取ると無関係な県に一致する（210 → 21 岐阜県）。2026-08-09 に 38 店舗が
    // 誤発動した経路。気象の区域コードは 6桁/7桁 なので、桁数で見分ける。
    for (const code of ['741', '210', '462']) {
      const scan = parseSpecialWarnings(withArea(code))
      expect(scan.kinds, code).toEqual(['大雨特別警報'])   // 種別は取れるが
      expect(scan.prefs.size, code).toBe(0)                // 都道府県は作らない
    }
  })

  it('6桁の府県予報区・7桁の市町村等からは作る', () => {
    expect([...parseSpecialWarnings(withArea('200000')).prefs.keys()]).toEqual(['20'])
    expect([...parseSpecialWarnings(withArea('2020100')).prefs.keys()]).toEqual(['20'])
  })

  it('分割された府県予報区でも先頭2桁は正しい都道府県', () => {
    // 北海道 012000/013000・鹿児島 460040・沖縄 471000〜474000。
    const cases: [string, string][] = [
      ['012000', '01'], ['013000', '01'], ['460040', '46'],
      ['471000', '47'], ['474000', '47'],
    ]
    for (const [code, pref] of cases) {
      expect([...parseSpecialWarnings(withArea(code)).prefs.keys()], code).toEqual([pref])
    }
  })

  it('JIS 範囲外（48〜）は採用しない', () => {
    expect(parseSpecialWarnings(withArea('480000')).prefs.size).toBe(0)
  })
})
