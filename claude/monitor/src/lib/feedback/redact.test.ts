import { describe, expect, it } from 'vitest'
import { REDACTED, redactFeedbackText as r } from './redact'

/**
 * 要望の本文の伏せ字（基本設計 §7・GVMS_CLOUD_SPEC §12.2 / §12.5-4）。
 *
 * 守りたい性質は 2 つ:
 *   ① 連絡先・URL・IP が**残らない**（伏せ漏れは取り返しがつかない。元の文は保存しない）
 *   ② 不具合の説明に要る数（版・日付・時刻・解像度・台数）は**消さない**
 */

describe('電話番号', () => {
  it.each([
    ['03-1234-5678'],
    ['090-1234-5678'],
    ['09012345678'],
    ['0312345678'],
    ['0120-123-456'],
    ['(03)1234-5678'],
    ['03(1234)5678'],
    ['+81-90-1234-5678'],
    ['+81 90 1234 5678'],
    ['03 1234 5678'],
    ['０９０－１２３４－５６７８'],
    ['０３ー１２３４ー５６７８'],
  ])('%s を伏せる', (phone) => {
    const out = r(`連絡は ${phone} まで`)
    expect(out).toBe(`連絡は ${REDACTED.phone} まで`)
  })

  it('文に続けて書いても伏せる（前後が日本語）', () => {
    expect(r('担当は090-1234-5678です')).toBe(`担当は${REDACTED.phone}です`)
  })

  it('隣の数とつながっても伏せ漏れにしない', () => {
    expect(r('03-1234-5678 10 台')).toBe(`${REDACTED.phone} 10 台`)
  })
})

describe('メールアドレス・URL・IP', () => {
  it('メールアドレスを伏せる（全角の＠も）', () => {
    expect(r('foo.bar+x@example.co.jp に返事を')).toBe(`${REDACTED.email} に返事を`)
    expect(r('foo＠example.com')).toBe(REDACTED.email)
  })

  it('URL を伏せる（http・https・rtsp・www.）', () => {
    expect(r('https://nvr.example.local/cgi?user=admin&pass=x を開くと')).toBe(`${REDACTED.url} を開くと`)
    expect(r('rtsp://admin:pass@192.168.0.101/stream が切れる')).toBe(`${REDACTED.url} が切れる`)
    expect(r('www.example.com で見た')).toBe(`${REDACTED.url} で見た`)
  })

  it('URL の後の句読点・括弧は残す', () => {
    expect(r('（https://example.com/a）。')).toBe(`（${REDACTED.url}）。`)
  })

  it('IPv4 を伏せる', () => {
    expect(r('192.168.0.101 のカメラ')).toBe(`${REDACTED.ip} のカメラ`)
    expect(r('10.0.0.1:8554')).toBe(`${REDACTED.ip}:8554`)
  })
})

describe('説明に要る数は消さない', () => {
  it.each([
    ['0.1.104 で直った'],
    ['2026-10-06 10:12 に止まった'],
    ['1920x1080 の 64 分割'],
    ['カメラ 250 台・ノード 3 台'],
    ['WV-S4176 ファーム 1.66'],
    ['エラー E-1001 が出る'],
    ['GOP 60 秒・15 fps'],
    ['価格は 1,234,567 円'],
  ])('%s', (text) => {
    expect(r(text)).toBe(text)
  })
})

it('複数まとめて伏せる', () => {
  const out = r('090-1234-5678 / a@b.jp / http://x.y / 172.16.1.2')
  expect(out).toBe(`${REDACTED.phone} / ${REDACTED.email} / ${REDACTED.url} / ${REDACTED.ip}`)
})
