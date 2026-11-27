import { describe, expect, it } from 'vitest'
import { otaRolloutView, sanitizeOtaRollout } from './ota-rollout'

const RUNNING = {
  version: '1.0.1', state: 'running', phase: 'apply', node: 'node203', done: 1, total: 3,
  started_at: '2026-11-27T01:00:00Z', updated_at: '2026-11-27T01:02:00Z',
}

describe('sanitizeOtaRollout（接続仕様 §15）', () => {
  it('決めた項目だけを写す', () => {
    expect(sanitizeOtaRollout({ ...RUNNING, package: 'AAAA', sig: 'x' })).toEqual(RUNNING)
  })

  it('★形の崩れた申告は null（heartbeat は拒否しない）', () => {
    for (const bad of [null, 'x', 1, [], {}, { ...RUNNING, state: 'exploded' }, { ...RUNNING, version: '' },
      { ...RUNNING, total: 0 }, { ...RUNNING, total: 65 }, { ...RUNNING, total: '3' }]) {
      expect(sanitizeOtaRollout(bad)).toBeNull()
    }
  })

  it('台数は範囲に収める・知らない段と読めない時刻は捨てる', () => {
    expect(sanitizeOtaRollout({ ...RUNNING, done: 9, phase: 'teleport', updated_at: 'きのう' }))
      .toEqual({ version: '1.0.1', state: 'running', node: 'node203', done: 3, total: 3, started_at: RUNNING.started_at })
    expect(sanitizeOtaRollout({ ...RUNNING, done: -2 })?.done).toBe(0)
  })

  it('止めた理由は failed のときだけ・500 字まで', () => {
    expect(sanitizeOtaRollout({ ...RUNNING, message: 'x' })?.message).toBeUndefined()
    const f = sanitizeOtaRollout({ version: '1.0.1', state: 'failed', node: 'node201', done: 0, total: 2, phase: 'apply', message: 'あ'.repeat(900) })
    expect(f?.message).toHaveLength(500)
    expect(f?.phase).toBeUndefined()
  })

  it('終わった作業は扱っているサーバを持たない', () => {
    expect(sanitizeOtaRollout({ version: '1.0.1', state: 'done', node: 'node203', done: 3, total: 3 }))
      .toEqual({ version: '1.0.1', state: 'done', done: 3, total: 3 })
  })
})

describe('otaRolloutView', () => {
  it('進行中: 何台中の何台目で、何をしているか', () => {
    const v = otaRolloutView(sanitizeOtaRollout(RUNNING)!)
    expect(v).toMatchObject({ tone: 'running', badge: '1 台ずつ更新中 1 / 3 台', detail: null })
    expect(v.text).toBe('版 1.0.1 へ更新中です。3 台中 2 台目（node203）: 入れ替えています。')
  })

  it('止めた: どこで止まり、何台済んだか・理由を添える', () => {
    const v = otaRolloutView({ version: '1.0.1', state: 'failed', node: 'node201', done: 1, total: 3, message: '空になりませんでした' })
    expect(v.tone).toBe('failed')
    expect(v.text).toContain('node201 で止めました（1 / 3 台が更新済み）')
    expect(v.detail).toBe('空になりませんでした')
  })

  it('終わった', () => {
    expect(otaRolloutView({ version: '1.0.1', state: 'done', done: 3, total: 3 }))
      .toMatchObject({ tone: 'done', text: '版 1.0.1 へ 3 台を 1 台ずつ更新しました。' })
  })
})
