import { describe, expect, it } from 'vitest'
import { withDownloadParam, jstStamp } from './saveJpeg'

// R2 移行で grid/snapshot ルートが別オリジンへ 302 するようになり、
// download パラメータが無いと fetch が CORS で弾かれて「保存失敗」になる。
// 一度実際に本番で踏んだ回帰なので、パラメータ付与をテストで固定する。
describe('withDownloadParam', () => {
  it('download=1 を付ける（これが無いと 302 先で CORS に弾かれる）', () => {
    expect(withDownloadParam('/api/edges/e1/grid'))
      .toBe('/api/edges/e1/grid?download=1')
  })

  it('既存クエリを壊さない', () => {
    expect(withDownloadParam('/api/edges/e1/grid?t=123'))
      .toBe('/api/edges/e1/grid?t=123&download=1')
  })

  it('同じパラメータを二重に付けない', () => {
    expect(withDownloadParam('/api/edges/e1/grid?download=1'))
      .toBe('/api/edges/e1/grid?download=1')
  })

  it('カメラ単体のスナップショットにも効く', () => {
    expect(withDownloadParam('/api/edges/e1/cam/c9/snapshot'))
      .toBe('/api/edges/e1/cam/c9/snapshot?download=1')
  })

  it('絶対URLはそのまま絶対URLで返す（別オリジン指定を勝手に相対化しない）', () => {
    expect(withDownloadParam('https://example.test/x.jpg', 'http://localhost'))
      .toBe('https://example.test/x.jpg?download=1')
  })
})

describe('jstStamp', () => {
  it('JST の YYYYMMDD_HHMMSS になる（UTC 深夜が翌日にずれる境界）', () => {
    // 2026-08-03T15:04:05Z = JST 2026-08-04 00:04:05
    expect(jstStamp(new Date('2026-08-03T15:04:05Z'))).toBe('20260804_000405')
  })
})
