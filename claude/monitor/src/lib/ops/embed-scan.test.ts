import { describe, expect, it } from 'vitest'
import { parseEmbeds, scanSource, uniquePairs } from './embed-scan'

/**
 * 埋め込み抽出のテスト。**抽出そのものが間違いうる**ので、パーサ単体で固定する。
 *
 * 取りこぼしは「0 件」という**正しく見える結果**を返す。2026-08-10 に
 * .gitignore で踏んだのと同じ形なので、ここは疑ってかかる。
 */

describe('parseEmbeds', () => {
  it('素の埋め込みを拾う（!inner が付かないほうが多数派）', () => {
    expect(parseEmbeds('id, stores ( id, name, area_code )', 'bcp_settings'))
      .toEqual([{ parent: 'bcp_settings', child: 'stores' }])
  })

  it('!inner / !left を拾う', () => {
    expect(parseEmbeds('id, stores!inner(tenant_id)', 'live_sessions'))
      .toEqual([{ parent: 'live_sessions', child: 'stores' }])
    expect(parseEmbeds('id, stores!left ( name )', 'x'))
      .toEqual([{ parent: 'x', child: 'stores' }])
  })

  it('別名付きでも本体の表名を返す', () => {
    // `store:stores(...)` の「store」は返り値のキー名であって表ではない。
    expect(parseEmbeds('id, store:stores ( name )', 'bcp_events'))
      .toEqual([{ parent: 'bcp_events', child: 'stores' }])
  })

  it('★入れ子は親子関係を保って全段返す', () => {
    // recorder_cameras → recorders → edge_devices の 2 段。
    // 外側だけ見ると、内側の外部キー欠落を見逃す。
    expect(parseEmbeds('id, recorders!inner ( edge_devices!inner ( store_id ) )', 'recorder_cameras'))
      .toEqual([
        { parent: 'recorder_cameras', child: 'recorders' },
        { parent: 'recorders', child: 'edge_devices' },
      ])
  })

  it('同じ階層に複数の埋め込みがあっても全部返す', () => {
    expect(parseEmbeds('id, stores ( name ), recorder_cameras ( id )', 'alarm_events'))
      .toEqual([
        { parent: 'alarm_events', child: 'stores' },
        { parent: 'alarm_events', child: 'recorder_cameras' },
      ])
  })

  it('埋め込みが無ければ空', () => {
    expect(parseEmbeds('id, name, created_at', 'stores')).toEqual([])
  })

  it('空白や改行が入っていても拾う', () => {
    expect(parseEmbeds('\n  id,\n  stores (\n    name\n  )\n', 'x'))
      .toEqual([{ parent: 'x', child: 'stores' }])
  })
})

describe('scanSource', () => {
  it('.from() と .select() の組から拾う', () => {
    const src = `
      const { data } = await supa
        .from('bcp_settings')
        .select('id, store_id, stores ( id, name, area_code )')
        .eq('enabled', true)
    `
    expect(scanSource(src)).toEqual([{ parent: 'bcp_settings', child: 'stores' }])
  })

  it('★別のチェーンを跨いで結び付けない', () => {
    // 間に別の .from() が挟まる場合は捨てる。**間違った組を報告するほうが
    // 取りこぼしより悪い**（実在しない不一致を追わせることになる）。
    const src = `
      await supa.from('a').eq('x', 1)
      await supa.from('b').select('id, stores ( name )')
    `
    expect(scanSource(src)).toEqual([{ parent: 'b', child: 'stores' }])
  })

  it('埋め込みを含まない select は無視する', () => {
    expect(scanSource(`supa.from('stores').select('id, name')`)).toEqual([])
  })

  it('1 ファイルに複数の問い合わせがあっても全部拾う', () => {
    const src = `
      supa.from('x').select('id, a ( id )')
      supa.from('y').select('id, b ( id )')
    `
    expect(scanSource(src)).toHaveLength(2)
  })

  it('テンプレートリテラルの select は拾わない（静的に読めない）', () => {
    // 拾えないものを拾えたことにしない。動的 select を使うなら
    // **その箇所は検査の外**であることを、ここで明示しておく。
    expect(scanSource('supa.from(\'x\').select(`id, ${cols} ( id )`)')).toEqual([])
  })
})

describe('uniquePairs', () => {
  it('重複を畳んで安定な順序で返す', () => {
    expect(uniquePairs([
      { parent: 'b', child: 'c' },
      { parent: 'a', child: 'b' },
      { parent: 'b', child: 'c' },
    ])).toEqual(['a→b', 'b→c'])
  })
})
