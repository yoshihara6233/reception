import { describe, expect, it } from 'vitest'
import { CRITICAL_COUNT, evaluateEvidenceGaps, type EvidenceFacts } from './evidence-gaps'

/**
 * 証跡の取りこぼしの判定。**事実は DB、判断はここ**（partition-health と同形）。
 *
 * 純粋関数なので「発報 5 件で 1 枚も撮れていない」という状況を直接作れる。
 * 本番でそれを再現するわけにはいかないので、**異常時に本当に鳴るか**を
 * 確かめられる唯一の場所。
 */

const OK: EvidenceFacts = {
  checked_at: '2026-08-13T04:00:00Z',
  days: 7,
  grace_minutes: 30,
  alarms: { recent: 0, older: 0, worst: [] },
  bcp:    { recent: 0, older: 0, not_due: 0, worst: [] },
}

const alarm = (store: string) => ({ store, occurred_at: '2026-08-13T03:00:00Z' })
const clip = (store: string, offset_min: number | null) => ({
  store, event_id: 'e1', offset_min, created_at: '2026-08-13T03:00:00Z',
})

describe('evaluateEvidenceGaps', () => {
  it('欠落が無ければ ok', () => {
    const v = evaluateEvidenceGaps(OK)
    expect(v.severity).toBe('ok')
    expect(v.problems).toEqual([])
  })

  it('★結果が空なら critical（監視が死んでいるのに緑にしない）', () => {
    const v = evaluateEvidenceGaps({})
    expect(v.severity).toBe('critical')
    expect(v.problems[0]).toContain('evidence_gaps()')
  })

  it('★撮影待ちがあるときは件数を出す（0 件表示だと「動いていない」と区別できない）', () => {
    const v = evaluateEvidenceGaps({ ...OK, bcp: { ...OK.bcp, not_due: 4 } })
    expect(v.severity).toBe('ok')
    expect(v.summary).toContain('撮影待ち 4 件')
  })

  describe('発報の前後スナップ', () => {
    it('★1 件でも欠けていれば warn', () => {
      const v = evaluateEvidenceGaps({
        ...OK, alarms: { recent: 1, older: 0, worst: [alarm('A店')] },
      })
      expect(v.severity).toBe('warn')
      expect(v.problems[0]).toContain('1 件')
      // 「送信済みに見えている」ことこそが問題なので、そこを書く。
      expect(v.problems[0]).toContain('送信済み')
      expect(v.problems[1]).toContain('A店')
    })

    it(`★${CRITICAL_COUNT} 件以上は critical（たまたまではなく仕組みが壊れている）`, () => {
      const worst = Array.from({ length: CRITICAL_COUNT }, (_, i) => alarm(`店${i}`))
      const v = evaluateEvidenceGaps({
        ...OK, alarms: { recent: CRITICAL_COUNT, older: 0, worst },
      })
      expect(v.severity).toBe('critical')
    })

    it('しきい値の 1 つ手前は warn のまま', () => {
      const v = evaluateEvidenceGaps({
        ...OK, alarms: { recent: CRITICAL_COUNT - 1, older: 0, worst: [] },
      })
      expect(v.severity).toBe('warn')
    })

    it('店舗名と発生時刻を JST で出す', () => {
      const v = evaluateEvidenceGaps({
        ...OK, alarms: { recent: 1, older: 0, worst: [alarm('渋谷店')] },
      })
      // 03:00 UTC = 12:00 JST
      expect(v.problems[1]).toContain('渋谷店')
      expect(v.problems[1]).toContain('12:00')
    })

    it('一覧は 5 件まで（メールが読めなくなると誰も読まない）', () => {
      const worst = Array.from({ length: 10 }, (_, i) => alarm(`店${i}`))
      const v = evaluateEvidenceGaps({ ...OK, alarms: { recent: 10, older: 0, worst } })
      expect(v.problems.filter((p) => p.startsWith('　'))).toHaveLength(5)
    })
  })

  describe('BCP クリップ', () => {
    it('★欠落があれば鳴る', () => {
      const v = evaluateEvidenceGaps({
        ...OK, bcp: { recent: 2, older: 0, not_due: 0, worst: [clip('B店', 5)] },
      })
      expect(v.severity).toBe('warn')
      expect(v.problems[0]).toContain('2 件')
      expect(v.problems[1]).toContain('+5分')
    })

    it('負のオフセット（発令前）も符号を落とさない', () => {
      const v = evaluateEvidenceGaps({
        ...OK, bcp: { recent: 1, older: 0, not_due: 0, worst: [clip('B店', -5)] },
      })
      expect(v.problems[1]).toContain('-5分')
    })

    it('offset_min が null（旧・動画クリップ）は (動画) と出す', () => {
      const v = evaluateEvidenceGaps({
        ...OK, bcp: { recent: 1, older: 0, not_due: 0, worst: [clip('B店', null)] },
      })
      expect(v.problems[1]).toContain('(動画)')
    })
  })

  it('★過去分は severity を上げないが、黙って消さない', () => {
    // 撮り直せないので鳴らす意味は薄い。ただし消すと「昔から欠けている」ことに
    // 誰も気づかない。
    const v = evaluateEvidenceGaps({
      ...OK,
      alarms: { recent: 0, older: 12, worst: [] },
      bcp:    { recent: 0, older: 3, not_due: 0, worst: [] },
    })
    expect(v.severity).toBe('ok')
    expect(v.problems.join()).toContain('15 件')
    expect(v.problems.join()).toContain('撮り直せない')
  })

  it('発報と BCP の両方が欠けていれば、要約は合算する', () => {
    const v = evaluateEvidenceGaps({
      ...OK,
      alarms: { recent: 2, older: 0, worst: [alarm('A店')] },
      bcp:    { recent: 1, older: 0, not_due: 0, worst: [clip('B店', 0)] },
    })
    expect(v.summary).toContain('3 件')
    expect(v.problems.join()).toContain('発報')
    expect(v.problems.join()).toContain('BCP')
  })

  it('★しきい値は発報・BCP で別々に見る（合算して上げない）', () => {
    // 「2 件 + 1 件 = 3 件だから critical」にはしない。
    // 発報の不調と BCP の不調は原因が別で、足し合わせる意味が無い。
    // 片方が単独でしきい値に達したときだけ「仕組みが壊れている」と扱う。
    const split = evaluateEvidenceGaps({
      ...OK,
      alarms: { recent: 2, older: 0, worst: [] },
      bcp:    { recent: 1, older: 0, not_due: 0, worst: [] },
    })
    expect(split.severity).toBe('warn')

    const concentrated = evaluateEvidenceGaps({
      ...OK, alarms: { recent: 3, older: 0, worst: [] },
    })
    expect(concentrated.severity).toBe('critical')
  })
})
