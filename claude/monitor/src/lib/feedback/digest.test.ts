import { describe, expect, it } from 'vitest'
import { DIGEST_MAX_ITEMS, digestWindow, renderDigest, type DigestItem } from './digest'

/**
 * 要望の新着のまとめメール（基本設計 §3.5）。
 *
 *   ★区切りは時計の 8:30（日本時間）。cron が遅れても前日 8:30〜当日 8:30 を取る
 *   ★業務が止まるを先頭に、件名にも件数を出す
 *   ★本文は HTML として解釈させない（現場の管理者が書いた自由文）
 */

const at = (iso: string) => new Date(iso)
const item = (over: Partial<DigestItem> = {}): DigestItem => ({
  id: 'i1', tenant_id: 't1', store_id: 's1', source: 'gvms', kind: 'request', urgency: 'nice_to_have',
  body: '分割を増やしたい', created_at: '2026-10-06T00:19:58Z', page_url: '/#/settings', attachment_type: null,
  ...over,
})
const base = {
  tenantNames: new Map([['t1', '某ドラッグストア様']]),
  storeNames: new Map([['s1', '銀座デモ店']]),
  untouched: 3,
  window: { from: at('2026-10-05T23:30:00Z'), to: at('2026-10-06T23:30:00Z') },
  boardUrl: 'https://gvms-cloud.com/admin/feedback',
  productName: 'G・VMS-Cloud',
}

describe('digestWindow', () => {
  it('★8:30 JST ちょうどに動けば、前日 8:30〜当日 8:30', () => {
    const w = digestWindow(at('2026-10-06T23:30:00Z')) // 10/7 8:30 JST
    expect(w.to.toISOString()).toBe('2026-10-06T23:30:00.000Z')
    expect(w.from.toISOString()).toBe('2026-10-05T23:30:00.000Z')
  })
  it('★cron が 7 分遅れても区切りは 8:30 のまま', () => {
    const w = digestWindow(at('2026-10-06T23:37:12Z'))
    expect(w.to.toISOString()).toBe('2026-10-06T23:30:00.000Z')
  })
  it('8:30 より前に手で動かしたら、前の日の 8:30 で区切る', () => {
    const w = digestWindow(at('2026-10-06T22:00:00Z')) // 10/7 7:00 JST
    expect(w.to.toISOString()).toBe('2026-10-05T23:30:00.000Z')
    expect(w.from.toISOString()).toBe('2026-10-04T23:30:00.000Z')
  })
})

describe('renderDigest', () => {
  it('件数・テナントと拠点・本文・画面・要望ボードへのリンクを載せる', () => {
    const { subject, html } = renderDigest({ ...base, items: [item({ attachment_type: 'image/jpeg' })] })
    expect(subject).toBe('[G・VMS-Cloud] 要望の新着 1 件')
    expect(html).toContain('某ドラッグストア様 / 銀座デモ店')
    expect(html).toContain('分割を増やしたい')
    expect(html).toContain('画面 /#/settings・画像あり')
    expect(html).toContain('10/06 09:19')
    expect(html).toContain('全部で 3 件')
    expect(html).toContain('href="https://gvms-cloud.com/admin/feedback"')
  })

  it('★業務が止まるを先頭に並べ、件名に件数を出す', () => {
    const { subject, html } = renderDigest({
      ...base,
      items: [
        item({ id: 'a', body: 'あとの要望', created_at: '2026-10-06T01:00:00Z' }),
        item({ id: 'b', body: '録画が止まる', urgency: 'blocking', created_at: '2026-10-06T05:00:00Z' }),
      ],
    })
    expect(subject).toBe('[G・VMS-Cloud] 要望の新着 2 件（業務が止まる 1 件）')
    expect(html.indexOf('録画が止まる')).toBeLessThan(html.indexOf('あとの要望'))
  })

  it('★本文の < > & はそのまま文字として出す', () => {
    const { html } = renderDigest({ ...base, items: [item({ body: '<script>alert(1)</script> & "x"' })] })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot;')
  })

  it('上限を超えた分は件数だけ書く', () => {
    const items = Array.from({ length: DIGEST_MAX_ITEMS + 3 }, (_, i) => item({ id: `i${i}` }))
    const { html } = renderDigest({ ...base, items })
    expect(html).toContain('ほか 3 件は要望ボードで見てください。')
  })

  it('拠点の無い要望 (クラウドの画面から) はテナント名だけ', () => {
    const { html } = renderDigest({ ...base, items: [item({ store_id: null, source: 'cloud' })] })
    expect(html).toContain('>某ドラッグストア様<br>')
  })
})
