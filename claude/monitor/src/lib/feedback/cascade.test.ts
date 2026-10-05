import { describe, expect, it } from 'vitest'
import { groupChanges, inheritFromTopic, planCascade } from './cascade'

/**
 * 話題の状態を束ねた要望へ写す決まり（基本設計 §3.5）。
 * DB への書き込みを伴う通しの試験は src/app/api/admin/feedback/feedback-admin.test.ts。
 */

const item = (id: string, status = 'received', reply: string | null = null, fixed_version: string | null = null) =>
  ({ id, status, reply, fixed_version })

describe('planCascade', () => {
  it('写す項目だけを、値が変わる要望にだけ当てる', () => {
    const changes = planCascade({ status: 'planned' }, [item('a'), item('b', 'planned'), item('c', 'reviewing', '個別の返事')])
    expect(changes).toEqual([
      { id: 'a', before: { status: 'received' }, after: { status: 'planned' } },
      { id: 'c', before: { status: 'reviewing' }, after: { status: 'planned' } },
    ])
  })

  it('返事と対応の版も写す（null で消すのも写す）', () => {
    const changes = planCascade({ status: 'done', reply: '0.1.104 で対応しました', fixed_version: '0.1.104' }, [item('a', 'planned', '検討します')])
    expect(changes[0].after).toEqual({ status: 'done', reply: '0.1.104 で対応しました', fixed_version: '0.1.104' })
    expect(changes[0].before).toEqual({ status: 'planned', reply: '検討します', fixed_version: null })
    expect(planCascade({ fixed_version: null }, [item('a', 'done', 'x', '0.1.104')])[0].after).toEqual({ fixed_version: null })
  })

  it('写す項目が無ければ何もしない', () => {
    expect(planCascade({}, [item('a')])).toEqual([])
  })

  it('★「見送り・返事なし」になる写しでは、要望の返事を消さない（DB の check に当たらない）', () => {
    const changes = planCascade({ reply: null }, [item('a', 'declined', '個別に見送り理由を書いた')])
    expect(changes).toEqual([])
  })
})

describe('inheritFromTopic（束ねたときに受け継ぐ値）', () => {
  it('状態は必ず受け継ぐ・返事と版は話題に値があるときだけ', () => {
    expect(inheritFromTopic({ status: 'reviewing', reply: null, fixed_version: null })).toEqual({ status: 'reviewing' })
    expect(inheritFromTopic({ status: 'done', reply: '対応しました', fixed_version: '0.1.104' }))
      .toEqual({ status: 'done', reply: '対応しました', fixed_version: '0.1.104' })
  })
})

describe('groupChanges', () => {
  it('同じ値へ変えるものを 1 つにまとめる（項目の順は問わない）', () => {
    const g = groupChanges([
      { id: 'a', before: {}, after: { status: 'done', reply: 'r' } },
      { id: 'b', before: {}, after: { reply: 'r', status: 'done' } },
      { id: 'c', before: {}, after: { status: 'done' } },
    ])
    expect(g).toHaveLength(2)
    expect(g.find((x) => x.ids.length === 2)?.ids).toEqual(['a', 'b'])
  })
})
