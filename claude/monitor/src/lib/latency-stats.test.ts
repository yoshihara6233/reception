import { describe, it, expect } from 'vitest'
import {
  percentile,
  normalizeTransport,
  summarizeTtff,
  estimateEgressGiB,
  TTFF_COLDSTART_TARGET_MS,
  type TtffSample,
} from './latency-stats'

describe('percentile', () => {
  it('空配列は null', () => {
    expect(percentile([], 0.5)).toBeNull()
  })
  it('単一要素はその値', () => {
    expect(percentile([42], 0.95)).toBe(42)
  })
  it('p50 / p95 が最近傍で返る', () => {
    const s = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    expect(percentile(s, 0.5)).toBe(50)
    expect(percentile(s, 0.95)).toBe(100)
  })
  it('p0 は最小、p100 は最大でクランプ', () => {
    const s = [1, 2, 3, 4]
    expect(percentile(s, 0)).toBe(1)
    expect(percentile(s, 1)).toBe(4)
  })
})

describe('normalizeTransport', () => {
  it('既知タグはそのまま', () => {
    expect(normalizeTransport('sfu')).toBe('sfu')
    expect(normalizeTransport('hls')).toBe('hls')
  })
  it('未知・欠損は other', () => {
    expect(normalizeTransport('mjpeg')).toBe('other')
    expect(normalizeTransport(undefined)).toBe('other')
    expect(normalizeTransport(null)).toBe('other')
  })
})

describe('summarizeTtff', () => {
  it('transport 別に集計し sfu→hls→other 順で返す', () => {
    const samples: TtffSample[] = [
      { value: 800, transport: 'sfu' },
      { value: 1200, transport: 'sfu' },
      { value: 3000, transport: 'hls' },
      { value: NaN, transport: 'sfu' },   // 無効値は除外
    ]
    const out = summarizeTtff(samples)
    expect(out.map((s) => s.transport)).toEqual(['sfu', 'hls'])
    const sfu = out[0]
    expect(sfu.count).toBe(2)
    expect(sfu.max).toBe(1200)
  })
  it('サンプル無しは空配列', () => {
    expect(summarizeTtff([])).toEqual([])
  })
})

describe('TTFF_COLDSTART_TARGET_MS', () => {
  it('SFU はオンデマンド起動込みなので HLS より緩い目標', () => {
    expect(TTFF_COLDSTART_TARGET_MS.sfu).toBeGreaterThan(TTFF_COLDSTART_TARGET_MS.hls)
  })
  it('全 transport に目標が定義されている', () => {
    expect(TTFF_COLDSTART_TARGET_MS.sfu).toBeGreaterThan(0)
    expect(TTFF_COLDSTART_TARGET_MS.hls).toBeGreaterThan(0)
    expect(TTFF_COLDSTART_TARGET_MS.other).toBeGreaterThan(0)
  })
})

describe('estimateEgressGiB', () => {
  it('2.5Mbps・60分で ~1.07 GiB', () => {
    // 2.5*60/8 = 18.75 MB/分 → 60分=1125MB → /1024 ≈ 1.0986 GiB
    expect(estimateEgressGiB(60)).toBeCloseTo(1.0986, 3)
  })
  it('0分は 0', () => {
    expect(estimateEgressGiB(0)).toBe(0)
  })
})
