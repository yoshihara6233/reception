import { describe, expect, it } from 'vitest'
import {
  AUDIO_KBPS, DOWNSCALE_BELOW_KBPS, MIN_VIDEO_KBPS, OVERHEAD_MARGIN,
  maxFittableSec, planFit,
} from './upload-fit.js'

/**
 * アップロード上限に収める判断。
 *
 * ── 守りたい性質 ────────────────────────────────────────────────────────
 * ① 上限内のものを**再エンコードしない**（CPU と世代劣化の無駄）
 * ② 収まらない長さを**取得前に断る**。文言に「最長何分か」を出す
 * ③ 縮小する場合、**上限に収まる帯域**を出す
 *
 * ②が要るのは、取ってから失敗すると NVR の同時処理枠と数十秒を捨てるうえ、
 * 現場に「範囲を短くすればいい」と伝わらないため。
 *
 * ── 背景 ────────────────────────────────────────────────────────────────
 * 2026-08-21、BCP の 5 分クリップが Storage の 50MB 上限で落ちた。返るのは
 * 「The object exceeded the maximum allowed size」だけで、何 MB だったかも
 * 残らなかった。既存 VOD は最大 60 分を要求でき、**同じ失敗は以前から起きていた**。
 */

const MB = 1048576
const CAP = 45 * MB

describe('planFit — 上限内', () => {
  it('★上限以下なら何もしない', () => {
    expect(planFit(10 * MB, 300, CAP)).toEqual({ kind: 'as-is' })
  })

  it('ちょうど上限も再エンコードしない（境界で無駄に作り直さない）', () => {
    expect(planFit(CAP, 300, CAP).kind).toBe('as-is')
  })

  it('1 バイト超えたら作り直す側に入る', () => {
    expect(planFit(CAP + 1, 300, CAP).kind).toBe('re-encode')
  })
})

describe('planFit — 縮小', () => {
  it('★5 分・80MB は収まる帯域で作り直す（今回のケース）', () => {
    const p = planFit(80 * MB, 5 * 60, CAP)
    expect(p.kind).toBe('re-encode')
    if (p.kind !== 're-encode') return
    // 出した帯域で 5 分作ると上限に収まること。
    const bits = (p.videoKbps + AUDIO_KBPS) * 1000 * 5 * 60
    expect(bits / 8).toBeLessThanOrEqual(CAP)
  })

  it('★長いほど帯域が下がる', () => {
    const short = planFit(80 * MB, 3 * 60, CAP)
    const long  = planFit(80 * MB, 15 * 60, CAP)
    if (short.kind !== 're-encode' || long.kind !== 're-encode') throw new Error('前提が崩れた')
    expect(long.videoKbps).toBeLessThan(short.videoKbps)
  })

  it('帯域が低いときだけ解像度を落とす（低帯域×高解像度はブロックノイズで判別不能）', () => {
    const low  = planFit(80 * MB, 15 * 60, CAP)
    const high = planFit(80 * MB, 60, CAP)
    if (low.kind !== 're-encode' || high.kind !== 're-encode') throw new Error('前提が崩れた')
    expect(low.videoKbps).toBeLessThan(DOWNSCALE_BELOW_KBPS)
    expect(low.downscale).toBe(true)
    expect(high.videoKbps).toBeGreaterThanOrEqual(DOWNSCALE_BELOW_KBPS)
    expect(high.downscale).toBe(false)
  })
})

describe('planFit — 断る', () => {
  it('★60 分は断る（既存 VOD が前から失敗していた範囲）', () => {
    const p = planFit(500 * MB, 60 * 60, CAP)
    expect(p.kind).toBe('reject')
    if (p.kind !== 'reject') return
    // 「範囲を短くすればいい」と分かる文面であること。
    expect(p.reason).toContain('最長')
    expect(p.reason).toContain('分')
  })

  it('★長さが分からないものは断る（黙って上げて Storage に弾かせない）', () => {
    expect(planFit(80 * MB, 0, CAP).kind).toBe('reject')
    expect(planFit(80 * MB, Number.NaN, CAP).kind).toBe('reject')
  })

  it('断る文面に実サイズと上限の両方が入る', () => {
    const p = planFit(80 * MB, 0, CAP)
    if (p.kind !== 'reject') throw new Error('前提が崩れた')
    expect(p.reason).toContain('80.0 MB')
    expect(p.reason).toContain('45 MB')
  })
})

describe('maxFittableSec', () => {
  it('★既定の 45MB では 16 分程度まで', () => {
    // 45MB × 8 × 0.95 / ((300 + 64) kbps) = 985 秒 = 16.4 分。
    // 音声の 64 kbps を足し忘れると 20 分と出る。UI の上限をここに合わせるので、
    // 数字がずれると「押せるのに保存できない」範囲が生まれる。
    const sec = maxFittableSec(CAP)
    expect(sec).toBeGreaterThan(15 * 60)
    expect(sec).toBeLessThan(17 * 60)
  })

  it('★5 分は収まる（今回直したかったケース）', () => {
    expect(maxFittableSec(CAP)).toBeGreaterThan(5 * 60)
  })

  it('上限を上げれば取れる長さも伸びる', () => {
    expect(maxFittableSec(90 * MB) / maxFittableSec(CAP)).toBeCloseTo(2, 1)
  })

  it('下限の帯域と音声を差し引いて計算している', () => {
    const expected = Math.floor((CAP * 8 * OVERHEAD_MARGIN) / ((MIN_VIDEO_KBPS + AUDIO_KBPS) * 1000))
    expect(maxFittableSec(CAP)).toBe(expected)
  })

  it('★極端に小さい上限では 1 分も取れない（断る側に倒れる）', () => {
    expect(maxFittableSec(1 * MB)).toBeLessThan(60)
  })
})

describe('定数の妥当性', () => {
  it('証跡として使える下限を保っている', () => {
    // ここを下げれば長い録画も通るが、店内の様子が判別できなくなる。
    // 通すために画質を犠牲にする変更を、無自覚に入れないための歯止め。
    expect(MIN_VIDEO_KBPS).toBeGreaterThanOrEqual(300)
  })

  it('音声を残す（証跡なので消さない）', () => {
    expect(AUDIO_KBPS).toBeGreaterThan(0)
  })
})
