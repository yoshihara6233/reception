import { describe, expect, it } from 'vitest'
import { SNAPSHOT_CLIP_MINUTES, snapshotClipKey, snapshotClipRange } from './snapshot-clip'

/**
 * スナップショットから切り出す区間。
 *
 * ── 守りたい性質 ────────────────────────────────────────────────────────
 * ① 「動画あり」の照合と、実際の取得要求が**同じ区間を指す**
 * ② DB が返す µ 秒付きの表記と、送信時の ISO が**同じキーになる**
 *
 * ②を落とすと、既にある動画を「無い」と表示し、毎回作り直すことになる。
 * 逆に区間がずれれば、「あり」と出したのに作り直しが走る。
 * どちらも例外にならないので、画面を見ても気づけない。
 */

describe('snapshotClipRange', () => {
  it('★コマの時刻から 5 分間', () => {
    const r = snapshotClipRange('2026-08-19T07:12:00.000Z')
    expect(r.fromIso).toBe('2026-08-19T07:12:00.000Z')
    expect(r.toIso).toBe('2026-08-19T07:17:00.000Z')
  })

  it('スナップの間隔と同じ長さ（コマ間が埋まる）', () => {
    expect(SNAPSHOT_CLIP_MINUTES).toBe(5)
  })

  it('★入力の表記ゆれを正規化する（DB は +00:00 形式で返す）', () => {
    const a = snapshotClipRange('2026-08-19T07:12:00+00:00')
    const b = snapshotClipRange('2026-08-19T07:12:00.000Z')
    expect(a).toEqual(b)
  })

  it('JST 表記で渡されても同じ瞬間を指す', () => {
    const a = snapshotClipRange('2026-08-19T16:12:00+09:00')
    expect(a.fromIso).toBe('2026-08-19T07:12:00.000Z')
  })
})

describe('snapshotClipKey', () => {
  it('★µ 秒付きと ms 付きが同じキーになる（DB と送信値の突き合わせ）', () => {
    const cam = 'cam-1'
    const fromDb = '2026-08-19T07:12:00.000123+00:00'
    const toDb   = '2026-08-19T07:17:00.000123+00:00'
    // µ 秒は Date が切り捨てるので、送信時の ms 表記と一致する。
    expect(snapshotClipKey(cam, fromDb, toDb))
      .toBe(snapshotClipKey(cam, '2026-08-19T07:12:00.000Z', '2026-08-19T07:17:00.000Z'))
  })

  it('カメラが違えば別のキー', () => {
    const f = '2026-08-19T07:12:00.000Z', t = '2026-08-19T07:17:00.000Z'
    expect(snapshotClipKey('cam-1', f, t)).not.toBe(snapshotClipKey('cam-2', f, t))
  })

  it('★長さが違えば別のキー（別区間を「あり」と誤認しない）', () => {
    const f = '2026-08-19T07:12:00.000Z'
    expect(snapshotClipKey('cam-1', f, '2026-08-19T07:17:00.000Z'))
      .not.toBe(snapshotClipKey('cam-1', f, '2026-08-19T07:22:00.000Z'))
  })
})
