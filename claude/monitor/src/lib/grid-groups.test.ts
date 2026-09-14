import { describe, expect, it } from 'vitest'
import { buildGridGroups, GRID_PAGE_SIZE } from './grid-groups'

const cam = (channel: number, folder_path: string | null = null) => ({ channel, folder_path })

describe('buildGridGroups', () => {
  it('フォルダごとにまとめ、channel 昇順に並べる', () => {
    const g = buildGridGroups([cam(3, '3F'), cam(1, '3F'), cam(2, '1F')], '未分類')
    expect(g.map((x) => x.label)).toEqual(['1F', '3F'])
    expect(g[1].pages[0].map((c) => c.channel)).toEqual([1, 3])
  })

  it('★17 台以上のフォルダは 16 台/ページに自動分割する', () => {
    const cams = Array.from({ length: 34 }, (_, i) => cam(i + 1, '物流'))
    const g = buildGridGroups(cams, '未分類')
    expect(g[0].pages.map((p) => p.length)).toEqual([16, 16, 2])
    // ページ 2 の先頭は 17 台目（切れ目でカメラが重複も欠落もしない）
    expect(g[0].pages[1][0].channel).toBe(17)
    expect(g[0].pages.flat()).toHaveLength(34)
  })

  it('未分類（folder_path なし/空白）は最後のグループになる', () => {
    const g = buildGridGroups([cam(1, null), cam(2, 'A'), cam(3, '  ')], '未分類')
    expect(g.map((x) => x.label)).toEqual(['A', '未分類'])
    expect(g[1].pages[0].map((c) => c.channel)).toEqual([1, 3])
    expect(g[1].key).toBe('__none__')
  })

  it('空配列なら空（グループ 0 件で画面側が非表示にする）', () => {
    expect(buildGridGroups([], '未分類')).toEqual([])
  })

  it('GRID_PAGE_SIZE は 16（エッジの 4×4 合成と一致していること）', () => {
    expect(GRID_PAGE_SIZE).toBe(16)
  })
})
