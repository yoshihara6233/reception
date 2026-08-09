import { describe, expect, it } from 'vitest'
import {
  evaluatePartitionHealth,
  PARTITION_JOBS,
  WATCHED_TABLES,
  type PartitionHealthFacts,
} from './partition-health'

/**
 * 「残り何ヶ月で鳴らすか」の判定。DB を触らずに、尽きかけ・尽きた・ジョブが
 * 消えた、といった状況を直接作れるのがこの分割の目的。
 *
 * 守りたいのは 2 つ:
 *   - 残余が減ったら鳴る（尽きてからでは遅い）
 *   - **残余があってもジョブが消えていたら鳴る**（数ヶ月後に必ず尽きるため。
 *     pg_cron のジョブは DB 移行で消える＝実際に起きる）
 */

/** 既定は「正常」。テストごとに壊したい所だけ上書きする。 */
function facts(over: Partial<PartitionHealthFacts> = {}): PartitionHealthFacts {
  return {
    pg_cron: true,
    tables: {
      live_sessions:   { last_partition: '202610', months_ahead: 2 },
      monitor_results: { last_partition: '202610', months_ahead: 2 },
    },
    jobs: {
      live_sessions_partition:   true,
      monitor_results_partition: true,
    },
    ...over,
  }
}

describe('evaluatePartitionHealth', () => {
  it('2ヶ月先まであってジョブも生きていれば ok', () => {
    const v = evaluatePartitionHealth(facts())
    expect(v.severity).toBe('ok')
    expect(v.problems).toEqual([])
    expect(v.runway).toEqual({ live_sessions: 2, monitor_results: 2 })
  })

  it('先が多い分には ok（cron が余分に作っても騒がない）', () => {
    expect(evaluatePartitionHealth(facts({
      tables: {
        live_sessions:   { last_partition: '202701', months_ahead: 5 },
        monitor_results: { last_partition: '202701', months_ahead: 5 },
      },
    })).severity).toBe('ok')
  })

  it('残り1ヶ月は critical（生成ジョブが1回失敗した状態）', () => {
    const v = evaluatePartitionHealth(facts({
      tables: {
        live_sessions:   { last_partition: '202609', months_ahead: 1 },
        monitor_results: { last_partition: '202610', months_ahead: 2 },
      },
    }))
    expect(v.severity).toBe('critical')
    expect(v.problems.join()).toContain('live_sessions')
  })

  it('残り0ヶ月は critical（来月頭に書き込みが落ちる）', () => {
    const v = evaluatePartitionHealth(facts({
      tables: {
        live_sessions:   { last_partition: '202608', months_ahead: 0 },
        monitor_results: { last_partition: '202608', months_ahead: 0 },
      },
    }))
    expect(v.severity).toBe('critical')
    expect(v.problems).toHaveLength(2)
    expect(v.summary).toContain('異常')
  })

  it('既に尽きている（負の残余）でも critical', () => {
    expect(evaluatePartitionHealth(facts({
      tables: {
        live_sessions:   { last_partition: '202607', months_ahead: -1 },
        monitor_results: { last_partition: '202610', months_ahead: 2 },
      },
    })).severity).toBe('critical')
  })

  it('残余があってもジョブが消えていれば critical', () => {
    // **これが一番起きる形**。DB を建て直すと pg_cron のジョブは消えるので、
    // 「今は足りているから大丈夫」に見えたまま数ヶ月後に尽きる。
    // 2026-08-09 に monitor_results_partition が実際にこの状態だった。
    const v = evaluatePartitionHealth(facts({
      jobs: { live_sessions_partition: true, monitor_results_partition: false },
    }))
    expect(v.severity).toBe('critical')
    expect(v.problems.join()).toContain('monitor_results_partition')
  })

  it('jobs のキーが丸ごと欠けていても critical（未定義を正常と読まない）', () => {
    const v = evaluatePartitionHealth(facts({ jobs: {} }))
    expect(v.severity).toBe('critical')
    expect(v.problems).toHaveLength(2)
  })

  it('pg_cron 拡張ごと無ければ critical', () => {
    const v = evaluatePartitionHealth(facts({ pg_cron: false, jobs: {} }))
    expect(v.severity).toBe('critical')
    expect(v.problems.join()).toContain('pg_cron')
    // 拡張が無いときはジョブの有無を重ねて責めない（原因は1つ）。
    expect(v.problems).toHaveLength(1)
  })

  it('表が1つも見つからなければ critical（空を正常と読まない）', () => {
    const v = evaluatePartitionHealth({ pg_cron: true, tables: {}, jobs: {
      live_sessions_partition: true, monitor_results_partition: true,
    } })
    expect(v.severity).toBe('critical')
    expect(v.problems).toHaveLength(2)
  })

  it('空の事実を渡しても ok にならない', () => {
    // RPC が壊れて {} を返した、という最悪ケース。
    expect(evaluatePartitionHealth({}).severity).toBe('critical')
  })

  it('監視対象すべてに生成ジョブ名が定義されている', () => {
    // 表を足したのにジョブ名を書き忘れると、その表のジョブ欠落を検出できない。
    for (const t of WATCHED_TABLES) expect(PARTITION_JOBS[t]).toBeTruthy()
  })
})
