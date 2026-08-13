import { describe, expect, it } from 'vitest'
import {
  CRITICAL_OFFSET_SEC,
  WARN_OFFSET_SEC,
  evaluateNvrClock,
  type NvrClockFacts,
} from './nvr-clock'

/**
 * NVR 時計ズレの判定。**事実は DB、判断はここ**（partition-health と同形）。
 *
 * 純粋関数なので「100 拠点中 37 台が +3 分ずれている」という状況を
 * テストで直接作れる。本番でそれを再現するわけにはいかないので、
 * **異常時に本当に鳴るか**を確かめられる唯一の場所。
 */

const OK: NvrClockFacts = {
  checked_at: '2026-08-13T04:00:00Z',
  warn_sec: WARN_OFFSET_SEC,
  stale_hours: 6,
  edges: 100,
  never_measured: 0,
  stale: 0,
  over_threshold: 0,
  max_abs_sec: 2,
  worst: [],
}

const edge = (store: string, sec: number) => ({
  store, edge: `edge-${store}`, offset_sec: sec, abs_sec: Math.abs(sec),
  checked_at: '2026-08-13T04:00:00Z',
})

describe('evaluateNvrClock', () => {
  it('全台がしきい値内なら ok', () => {
    const v = evaluateNvrClock(OK)
    expect(v.severity).toBe('ok')
    expect(v.problems).toEqual([])
    expect(v.summary).toContain('100 台')
  })

  it('★結果が空なら critical（監視が死んでいるのに緑にしない）', () => {
    const v = evaluateNvrClock({} as NvrClockFacts)
    expect(v.severity).toBe('critical')
    expect(v.problems[0]).toContain('nvr_clock_fleet()')
  })

  it('エッジが 0 台なら ok（ローカル・新規テナント）', () => {
    expect(evaluateNvrClock({ ...OK, edges: 0 }).severity).toBe('ok')
  })

  it('★秒単位のズレは warn', () => {
    const v = evaluateNvrClock({
      ...OK, over_threshold: 3, max_abs_sec: 25,
      worst: [edge('A店', 25), edge('B店', -18), edge('C店', 12)],
    })
    expect(v.severity).toBe('warn')
    expect(v.problems[0]).toContain('3 / 100 台')
    expect(v.problems[0]).toContain('記録された時刻とずれています')
  })

  it('★分単位のズレは critical（証跡として使えない水準）', () => {
    // NTP 未設定で +3 分、という実例がそのままこれ。
    const v = evaluateNvrClock({
      ...OK, over_threshold: 37, max_abs_sec: 185, worst: [edge('A店', 185)],
    })
    expect(v.severity).toBe('critical')
    expect(v.summary).toContain('分単位')
  })

  it('しきい値ちょうど上は critical に切り替わる', () => {
    const under = evaluateNvrClock({ ...OK, over_threshold: 1, max_abs_sec: CRITICAL_OFFSET_SEC - 1 })
    const over  = evaluateNvrClock({ ...OK, over_threshold: 1, max_abs_sec: CRITICAL_OFFSET_SEC })
    expect(under.severity).toBe('warn')
    expect(over.severity).toBe('critical')
  })

  it('★100 拠点ぶんを並べない（上位 10 台＋残りは件数）', () => {
    // 全部並べるとメールが読めなくなり、結果として誰も読まなくなる。
    const worst = Array.from({ length: 20 }, (_, i) => edge(`店${i}`, 30 - i))
    const v = evaluateNvrClock({ ...OK, over_threshold: 37, max_abs_sec: 30, worst })
    const listed = v.problems.filter((p) => p.startsWith('　') && !p.includes('他 '))
    expect(listed).toHaveLength(10)
    expect(v.problems.at(-1)).toContain('他 27 台')
  })

  it('符号を落とさない（進んでいる／遅れている）', () => {
    const v = evaluateNvrClock({ ...OK, over_threshold: 2, max_abs_sec: 20,
      worst: [edge('進A', 20), edge('遅B', -15)] })
    expect(v.problems.join()).toContain('+20 秒')
    expect(v.problems.join()).toContain('-15 秒')
  })

  it('★一度も測れていない台があれば warn（ズレの有無すら分からない）', () => {
    const v = evaluateNvrClock({ ...OK, never_measured: 12 })
    expect(v.severity).toBe('warn')
    expect(v.problems[0]).toContain('12 / 100 台')
    expect(v.problems[0]).toContain('ズレの有無が分かりません')
  })

  it('★実測が止まっていれば warn（30 分毎のはず）', () => {
    const v = evaluateNvrClock({ ...OK, stale: 5 })
    expect(v.severity).toBe('warn')
    expect(v.problems[0]).toContain('6 時間以上')
  })

  it('ズレ・未計測・停止が混ざれば全部挙げる', () => {
    const v = evaluateNvrClock({
      ...OK, over_threshold: 2, max_abs_sec: 20, worst: [edge('A', 20), edge('B', 15)],
      never_measured: 3, stale: 1,
    })
    expect(v.severity).toBe('warn')
    // ズレ 1 行 + 上位 2 台 + 未計測 + 停止
    expect(v.problems.length).toBeGreaterThanOrEqual(5)
    expect(v.summary).toContain('6 台')   // 2 + 3 + 1
  })

  it('critical と warn が混ざれば critical', () => {
    const v = evaluateNvrClock({ ...OK, over_threshold: 1, max_abs_sec: 200, never_measured: 4 })
    expect(v.severity).toBe('critical')
  })
})
