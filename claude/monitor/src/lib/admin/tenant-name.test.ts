import { describe, expect, it } from 'vitest'
import { sameTenantName } from './tenant-name'

describe('テナントの削除で打ち込む名前の照合', () => {
  it('空白の全角・半角・個数と前後の空白は見ない', () => {
    expect(sameTenantName('某デベロッパー様 デモ', '某デベロッパー様　デモ')).toBe(true)
    expect(sameTenantName(' 某デベロッパー様  デモ ', '某デベロッパー様　デモ')).toBe(true)
  })
  it('英数字の全角・半角は見ない', () => {
    expect(sameTenantName('ABC 1号', 'ＡＢＣ　１号')).toBe(true)
  })
  it('文字が違えば通さない・空は通さない', () => {
    expect(sameTenantName('某デベロッパー様', '某デベロッパー様　デモ')).toBe(false)
    expect(sameTenantName('某家電量販店', '某デベロッパー様　デモ')).toBe(false)
    expect(sameTenantName('   ', '　')).toBe(false)
  })
})
