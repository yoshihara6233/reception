import { describe, expect, it } from 'vitest'
import {
  REFRESH_EVERY_MS, VIEWER_STALE_MS, describeVideoError, normalizeVideoError, normalizeVodRange,
  parseHlsPath, pickVideoAction, shouldFallbackToJpeg, type DispatchRow,
} from './session-logic'

const NOW = Date.parse('2026-10-01T01:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

function row(p: Partial<DispatchRow> & { id: string }): DispatchRow {
  return {
    kind: 'hls_live', state: 'requested', viewer_seen_at: ago(1_000),
    stop_requested_at: null, refresh_sent_at: null, dispatched_at: null, ...p,
  }
}

describe('pickVideoAction', () => {
  it('何も無ければ null', () => {
    expect(pickVideoAction([], NOW)).toBeNull()
  })

  it('開いたばかりのセッションは開始を渡す', () => {
    expect(pickVideoAction([row({ id: 'a' })], NOW)).toMatchObject({ type: 'start', row: { id: 'a' } })
  })

  it('止めるのを開始より先に渡す（同時視聴の枠を空けてから次を始める）', () => {
    const act = pickVideoAction([
      row({ id: 'new' }),
      row({ id: 'old', state: 'started', dispatched_at: ago(5_000), stop_requested_at: ago(500) }),
    ], NOW)
    expect(act).toMatchObject({ type: 'stop', row: { id: 'old' } })
  })

  it('まだ拠点へ渡していないセッションを閉じたら、指示は出さずに落とす', () => {
    expect(pickVideoAction([row({ id: 'a', stop_requested_at: ago(100) })], NOW)).toMatchObject({ type: 'drop' })
  })

  it('画面の生存が途切れたら止める（拠点の 60 秒を待たない・§7-1）', () => {
    const r = row({ id: 'a', state: 'started', dispatched_at: ago(60_000), viewer_seen_at: ago(VIEWER_STALE_MS + 1) })
    expect(pickVideoAction([r], NOW)).toMatchObject({ type: 'stop' })
  })

  it('30 秒ごとに合図を渡す', () => {
    const fresh = row({ id: 'a', state: 'started', dispatched_at: ago(60_000), refresh_sent_at: ago(REFRESH_EVERY_MS - 1) })
    expect(pickVideoAction([fresh], NOW)).toBeNull()
    const due = row({ id: 'a', state: 'started', dispatched_at: ago(60_000), refresh_sent_at: ago(REFRESH_EVERY_MS) })
    expect(pickVideoAction([due], NOW)).toMatchObject({ type: 'refresh' })
  })

  it('初回の合図は開始を渡してから 30 秒後', () => {
    expect(pickVideoAction([row({ id: 'a', state: 'dispatched', dispatched_at: ago(10_000) })], NOW)).toBeNull()
    expect(pickVideoAction([row({ id: 'a', state: 'dispatched', dispatched_at: ago(31_000) })], NOW))
      .toMatchObject({ type: 'refresh' })
  })

  it('終わったセッションには何も渡さない', () => {
    expect(pickVideoAction([row({ id: 'a', state: 'stopped', stop_requested_at: ago(1) })], NOW)).toBeNull()
  })
})

describe('parseHlsPath（§5.2.2: s/<seq> を置き場 seq % 置き場の数 へ）', () => {
  it('プレイリスト・初期化区切り', () => {
    expect(parseHlsPath(['index.m3u8'], 'hls_live')).toEqual({ kind: 'playlist' })
    expect(parseHlsPath(['init.mp4'], 'hls_live')).toEqual({ kind: 'init' })
  })

  it('ライブは 8、録画再生は 16 の輪番', () => {
    expect(parseHlsPath(['s', '1204.ts'], 'hls_live')).toEqual({ kind: 'segment', slot: 4, ext: 'ts' })
    expect(parseHlsPath(['s', '1204.m4s'], 'hls_vod')).toEqual({ kind: 'segment', slot: 4, ext: 'm4s' })
    expect(parseHlsPath(['s', '1215.ts'], 'hls_vod')).toEqual({ kind: 'segment', slot: 15, ext: 'ts' })
  })

  it('それ以外のパスは読まない（置き場の外を指させない）', () => {
    for (const p of [['s', '../playlist'], ['s', '12.mp4'], ['s', '-1.ts'], ['playlist'], ['s', '1.ts', 'x'], ['slot0']]) {
      expect(parseHlsPath(p, 'hls_live')).toBeNull()
    }
  })
})

describe('失敗の扱い（§5.1）', () => {
  it('busy / bandwidth / codec_unsupported は静止画ライブへ戻す', () => {
    for (const e of ['busy', 'bandwidth', 'codec_unsupported']) expect(shouldFallbackToJpeg(e)).toBe(true)
    for (const e of ['offline', 'internal', 'unknown_camera', null, undefined]) expect(shouldFallbackToJpeg(e)).toBe(false)
  })

  it('知らない値は internal に丸める（拠点の文言をそのまま画面に出さない）', () => {
    expect(normalizeVideoError('busy')).toBe('busy')
    expect(normalizeVideoError('ffmpeg exited 1: /var/lib/…')).toBe('internal')
    expect(normalizeVideoError(null)).toBe('internal')
  })

  it('説明文は値そのものを含まない', () => {
    expect(describeVideoError('codec_unsupported')).not.toContain('codec')
  })
})

describe('normalizeVodRange（§5.3.1）', () => {
  it('to を省くと 60 分', () => {
    const r = normalizeVodRange('2026-10-01T09:00:00+09:00')!
    expect(r.to.getTime() - r.from.getTime()).toBe(60 * 60_000)
  })

  it('4 時間で切る', () => {
    const r = normalizeVodRange('2026-10-01T00:00:00Z', '2026-10-01T10:00:00Z')!
    expect(r.to.toISOString()).toBe('2026-10-01T04:00:00.000Z')
  })

  it('逆転・不正は null', () => {
    expect(normalizeVodRange('2026-10-01T10:00:00Z', '2026-10-01T09:00:00Z')).toBeNull()
    expect(normalizeVodRange('not-a-date')).toBeNull()
  })
})
