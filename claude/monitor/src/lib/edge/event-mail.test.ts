import { describe, expect, it } from 'vitest'
import { edgeEventMailHtml } from './event-mail'

describe('edgeEventMailHtml', () => {
  it('件名のくり返しではなく、時刻・ノード・次にすることを書く', () => {
    const html = edgeEventMailHtml({
      storeName: '本店', edgeName: 'gvms-201', label: 'ノード離脱', eventType: 'node_down',
      node: 201, occurredAt: '2026-11-04T04:33:04Z', message: '録画ノード node201 の応答がありません',
    })
    expect(html).toContain('2026/11/04 13:33:04')
    expect(html).toContain('node201')
    expect(html).toContain('自動で引き継ぎます')
  })
  it('本文の文字を逃がす', () => {
    const html = edgeEventMailHtml({
      storeName: '<b>x</b>', edgeName: 'e', label: 'l', eventType: 'other', node: null, occurredAt: 'bad', message: null,
    })
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
  })
})
