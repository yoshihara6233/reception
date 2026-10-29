import { afterEach, describe, expect, it } from 'vitest'
import { allowedUpstreamOrigin, safeContentType, safeSubPath } from './upstream'

afterEach(() => { delete process.env.UPSTREAM_ALLOWED_HOST_SUFFIXES })

describe('上流の宛先 (サービストークンを外へ送らない・ASVS 13.2.4)', () => {
  it('既定は https の *.genesis-edge.com だけ', () => {
    expect(allowedUpstreamOrigin('https://go2rtc-poc.genesis-edge.com/api')).toBe('https://go2rtc-poc.genesis-edge.com')
    expect(allowedUpstreamOrigin('https://a.b.genesis-edge.com:8443/x')).toBe('https://a.b.genesis-edge.com:8443')
    for (const ng of ['http://go2rtc-poc.genesis-edge.com', 'https://evil.example', 'https://genesis-edge.com.evil.example',
      'https://evilgenesis-edge.com', 'https://genesis-edge.com', 'https://u:p@x.genesis-edge.com', 'not a url', null, '']) {
      expect(allowedUpstreamOrigin(ng), String(ng)).toBeNull()
    }
  })
  it('環境変数で許す名前を足せる', () => {
    process.env.UPSTREAM_ALLOWED_HOST_SUFFIXES = 'genesis-edge.com, .cams.example.jp'
    expect(allowedUpstreamOrigin('https://x.cams.example.jp')).toBe('https://x.cams.example.jp')
    expect(allowedUpstreamOrigin('https://x.example.jp')).toBeNull()
  })
})

describe('経路の部品 (許した経路の外へ届かせない・ASVS 1.1.1)', () => {
  const P = ['api/stream.m3u8', 'api/hls/']
  it('許した経路だけ通す', () => {
    expect(safeSubPath(['api', 'stream.m3u8'], P)).toBe('api/stream.m3u8')
    expect(safeSubPath(['api', 'hls', 'playlist.m3u8'], P)).toBe('api/hls/playlist.m3u8')
    expect(safeSubPath(['api', 'streams'], P)).toBeNull()
    expect(safeSubPath(['api', 'stream.m3u8x'], P)).toBeNull()
  })
  it('`..`・`.`・区切りや % を含む部品は断る', () => {
    for (const segs of [['api', 'hls', '..', 'streams'], ['api', 'hls', '.', 'x'], ['api', 'hls', 'a/b'],
      ['api', 'hls', 'a%2fb'], ['api', 'hls', 'a\\b'], ['api', 'hls', ''], []]) {
      expect(safeSubPath(segs, P), segs.join('|')).toBeNull()
    }
  })
})

describe('応答の型 (このサイトの上で HTML を描画させない・ASVS 3.2.1)', () => {
  it('HLS の型はそのまま、それ以外は octet-stream', () => {
    expect(safeContentType('application/vnd.apple.mpegurl')).toBe('application/vnd.apple.mpegurl')
    expect(safeContentType('video/MP2T; charset=x')).toBe('video/mp2t')
    expect(safeContentType('text/html; charset=utf-8')).toBe('application/octet-stream')
    expect(safeContentType('image/svg+xml')).toBe('application/octet-stream')
    expect(safeContentType(null)).toBe('application/octet-stream')
  })
})
