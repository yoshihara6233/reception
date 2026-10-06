import { describe, expect, it } from 'vitest'
import { aggregateBcpStatus } from './aggregate-status'

describe('aggregateBcpStatus (BCP の一覧の親の行)', () => {
  it('取得中が 1 つでもあれば取得中', () => {
    expect(aggregateBcpStatus(['completed', 'recording', 'failed'])).toBe('in_progress')
    expect(aggregateBcpStatus(['pending'])).toBe('in_progress')
  })
  it('★全部が失敗のときだけ失敗', () => {
    expect(aggregateBcpStatus(['failed', 'failed'])).toBe('failed')
  })
  it('★取れなかった拠点 (未設置) が混ざっても、取れた拠点があれば一部', () => {
    expect(aggregateBcpStatus(['completed', 'failed'])).toBe('partial')
    expect(aggregateBcpStatus(['report_generated', 'failed', 'clips_uploaded'])).toBe('partial')
  })
  it('全部が終わったら完了', () => {
    expect(aggregateBcpStatus(['completed', 'report_generated', 'clips_uploaded'])).toBe('completed')
  })
})
