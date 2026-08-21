import { describe, expect, it } from 'vitest'
import { areaCodeLabel, prefCode, prefLabel, prefName } from './jp-prefectures'

/**
 * 都道府県コードの正規化。
 *
 * ── 守りたい性質 ────────────────────────────────────────────────────────
 * ① **実データの 3 書式すべてから名前が引ける**
 *    stores.area_code = JIS 市区町村 5 桁 / bcp_events.area_code = 2 桁 /
 *    旧実装 = ISO 'JP-43'
 * ② 引けないコードで**落ちない・嘘をつかない**（コードをそのまま返す）
 *
 * ── 実際にあった不具合 ──────────────────────────────────────────────────
 * 旧 prefLabel() は 'JP-43' しか引けず、本番の 43100 / 43 はどちらも
 * 素通りして生のコードを表示していた。例外も出ないため、画面を見た人が
 * 「そういう仕様」と思うだけで、誰も不具合と気づけなかった。
 */

describe('prefName — 3 つの書式', () => {
  it('★ISO 形式（旧実装の書式）', () => {
    expect(prefName('JP-43')).toBe('熊本県')
  })

  it('★2 桁（bcp_events.area_code）', () => {
    expect(prefName('43')).toBe('熊本県')
    expect(prefName('40')).toBe('福岡県')
    expect(prefName('42')).toBe('長崎県')
  })

  it('★5 桁の JIS 市区町村コード（stores.area_code）', () => {
    // 43100 = 熊本市。J-Alert の照合も先頭 2 桁を都道府県として使う。
    expect(prefName('43100')).toBe('熊本県')
    expect(prefName('13101')).toBe('東京都')
  })

  it('1 桁は 0 埋めして引く', () => {
    expect(prefName('4')).toBe('宮城県')
  })

  it('前後の空白を無視する（CSV 取込の実データ対策）', () => {
    expect(prefName(' 43 ')).toBe('熊本県')
  })
})

describe('prefName — 引けないもの', () => {
  it('null / 空文字は null', () => {
    expect(prefName(null)).toBeNull()
    expect(prefName(undefined)).toBeNull()
    expect(prefName('')).toBeNull()
    expect(prefName('   ')).toBeNull()
  })

  it('★存在しない番号は null（勝手に近い県に丸めない）', () => {
    expect(prefName('48')).toBeNull()
    expect(prefName('00')).toBeNull()
    expect(prefName('99999')).toBeNull()
  })

  it('数字でないものは null', () => {
    expect(prefName('東京')).toBeNull()
    expect(prefName('JP-XX')).toBeNull()
  })
})

describe('表示ラベル', () => {
  it('prefLabel は「県名（コード）」', () => {
    expect(prefLabel('43100')).toBe('熊本県（43100）')
    expect(prefLabel('JP-13')).toBe('東京都（JP-13）')
  })

  it('★引けないコードは落とさずそのまま出す', () => {
    expect(prefLabel('99999')).toBe('99999')
    expect(prefLabel(null)).toBe('未設定')
  })

  it('areaCodeLabel は「コード 県名」（BCP 一覧は等幅で桁を揃えている）', () => {
    expect(areaCodeLabel('43')).toBe('43 熊本県')
    expect(areaCodeLabel('40')).toBe('40 福岡県')
  })

  it('areaCodeLabel は未設定を — にする', () => {
    expect(areaCodeLabel(null)).toBe('—')
    expect(areaCodeLabel('99')).toBe('99')
  })
})


describe('prefCode — グループ化のキー', () => {
  it('★市区町村コードから都道府県 2 桁を取り出す', () => {
    // 完全一致でまとめると、同じ県が市ごとに割れて「熊本県」が 2 つ並ぶ。
    expect(prefCode('43100')).toBe('43')
    expect(prefCode('43201')).toBe('43')
  })

  it('県レベルのコードもそのまま 2 桁', () => {
    expect(prefCode('01000')).toBe('01')
    expect(prefCode('01')).toBe('01')
  })

  it('ISO 形式も受ける', () => {
    expect(prefCode('JP-13')).toBe('13')
  })

  it('★存在しない番号は null（未分類に落とす）', () => {
    expect(prefCode('99999')).toBeNull()
    expect(prefCode('東京')).toBeNull()
    expect(prefCode(null)).toBeNull()
  })

  it('★同じ県の別の市が同じキーになる（グループが割れない）', () => {
    expect(prefCode('43100')).toBe(prefCode('43201'))
  })
})
