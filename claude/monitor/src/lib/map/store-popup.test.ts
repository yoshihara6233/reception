import { describe, it, expect } from 'vitest'
import { escapeHtml, storePopupHtml } from './store-popup'

describe('地図の拠点の吹き出し (自主診断 ASVS 3.2.2)', () => {
  it('拠点の名前と住所の HTML の特別な文字を逃がす', () => {
    const html = storePopupHtml(
      { id: 's-1', name: '<b>本店</b>', address: '大阪市"北区" & <i>梅田</i>' },
      { color: '#2F7A4F', label: 'オンライン' },
    )
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('<i>')
    expect(html).toContain('&lt;b&gt;本店&lt;/b&gt;')
    expect(html).toContain('&quot;北区&quot; &amp; &lt;i&gt;梅田&lt;/i&gt;')
  })

  it('属性の値も逃がす (引用符で属性から抜け出せない)', () => {
    const html = storePopupHtml({ id: 'a"b', name: 'x', address: null }, { color: 'red" x="y', label: 'l' })
    expect(html).toContain('data-store-id="a&quot;b"')
    expect(html).toContain('href="/stores/a%22b"')
    expect(html).toContain('background:red&quot; x=&quot;y')
  })

  it('住所が無ければ住所の行を出さない', () => {
    expect(storePopupHtml({ id: 's', name: 'n', address: '' }, { color: '#000', label: 'l' })).not.toContain('color:#64748b')
  })

  it('escapeHtml は 5 文字を逃がす', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})
