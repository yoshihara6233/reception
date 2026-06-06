/**
 * F50.C: メトリクスのユニットテスト
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Counter, Gauge, Histogram, registry } from './metrics'

describe('Counter', () => {
  beforeEach(() => { /* registry はシングルトンなので、テスト名で区別する */ })

  it('inc で増加 / serialize で Prometheus 形式', () => {
    const c = new Counter('test_counter_1', 'help', ['ok'])
    c.inc({ ok: 'true' })
    c.inc({ ok: 'true' })
    c.inc({ ok: 'false' })
    const text = c.serialize()
    expect(text).toContain('# TYPE test_counter_1 counter')
    expect(text).toMatch(/test_counter_1\{ok="true"\} 2/)
    expect(text).toMatch(/test_counter_1\{ok="false"\} 1/)
  })

  it('未知のラベルで例外', () => {
    const c = new Counter('test_counter_2', 'help', ['ok'])
    expect(() => c.inc({ unknown: 'x' })).toThrow(/unknown label/)
  })

  it('ラベル空 → 単一値', () => {
    const c = new Counter('test_counter_3', 'help')
    c.inc({}, 5)
    expect(c.serialize()).toMatch(/test_counter_3 5/)
  })
})

describe('Gauge', () => {
  it('set/inc/dec', () => {
    const g = new Gauge('test_gauge_1', 'help')
    g.set(10)
    g.inc({}, 5)
    g.dec({}, 3)
    expect(g.serialize()).toMatch(/test_gauge_1 12/)
  })
})

describe('Histogram', () => {
  it('observe + serialize bucket/sum/count', () => {
    const h = new Histogram('test_hist_1', 'help', [], [0.1, 0.5, 1, 5])
    h.observe(0.05)
    h.observe(0.3)
    h.observe(2)
    const text = h.serialize()
    expect(text).toContain('# TYPE test_hist_1 histogram')
    expect(text).toMatch(/test_hist_1_bucket\{le="0.1"\} 1/)
    expect(text).toMatch(/test_hist_1_bucket\{le="0.5"\} 2/)
    expect(text).toMatch(/test_hist_1_bucket\{le="1"\} 2/)
    expect(text).toMatch(/test_hist_1_bucket\{le="5"\} 3/)
    expect(text).toMatch(/test_hist_1_bucket\{le="\+Inf"\} 3/)
    expect(text).toMatch(/test_hist_1_count 3/)
    expect(text).toMatch(/test_hist_1_sum 2.35/)
  })

  it('observeMs で秒に換算', () => {
    const h = new Histogram('test_hist_2', 'help')
    h.observeMs(500)
    expect(h.serialize()).toMatch(/test_hist_2_sum 0.5/)
  })
})

describe('Registry', () => {
  it('全メトリクスをまとめて serialize', () => {
    new Counter('reg_c', 'c', [])
    new Gauge('reg_g', 'g', [])
    const text = registry.serialize()
    expect(text).toContain('reg_c')
    expect(text).toContain('reg_g')
  })
})
