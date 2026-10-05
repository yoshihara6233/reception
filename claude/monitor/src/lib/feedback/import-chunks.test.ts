import { describe, expect, it } from 'vitest'
import { chunkImportItems } from './import-chunks'

describe('chunkImportItems — 取り込みの分割', () => {
  it('小さな要望はまとめて 1 回で送る', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ local_id: `l${i}`, body: 'あ' }))
    const chunks = chunkImportItems(items)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ start: 0, items })
  })

  it('★上限を超えないよう区切り、start で元の番号に戻せる', () => {
    const big = (i: number) => ({ local_id: `l${i}`, attachment: { data_base64: 'A'.repeat(400) } })
    const items = Array.from({ length: 5 }, (_, i) => big(i))
    const chunks = chunkImportItems(items, 1000)
    expect(chunks.map((c) => c.start)).toEqual([0, 2, 4])
    expect(chunks.flatMap((c) => c.items)).toEqual(items)
  })

  it('1 件だけで上限を超えるものは、その 1 件だけで送る', () => {
    const items = [{ a: 1 }, { a: 'x'.repeat(2000) }, { a: 2 }]
    const chunks = chunkImportItems(items, 1000)
    expect(chunks.map((c) => c.items.length)).toEqual([1, 1, 1])
    expect(chunks.map((c) => c.start)).toEqual([0, 1, 2])
  })

  it('空なら何も送らない', () => {
    expect(chunkImportItems([])).toEqual([])
  })
})
