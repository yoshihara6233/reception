import { describe, it, expect } from 'vitest'
import { go2rtcRtspUrl, buildSfuFfmpegArgs } from '../modes/sfu-publish-core.js'

describe('go2rtcRtspUrl', () => {
  it(':18554 形式（host省略）は 127.0.0.1 を補う', () => {
    expect(go2rtcRtspUrl('abc123', ':18554')).toBe('rtsp://127.0.0.1:18554/cam_abc123')
  })
  it('host付き listen はそのまま使う', () => {
    expect(go2rtcRtspUrl('abc', '127.0.0.1:9554')).toBe('rtsp://127.0.0.1:9554/cam_abc')
  })
  it('stream 名は monitor の hqUrl と同じ cam_<id>', () => {
    expect(go2rtcRtspUrl('98fa4408', ':18554')).toContain('/cam_98fa4408')
  })
})

describe('buildSfuFfmpegArgs', () => {
  it('再エンコードしない（-c:v copy）', () => {
    const a = buildSfuFfmpegArgs('rtsp://src', 'http://proxy/whip?upstream=x')
    const i = a.indexOf('-c:v')
    expect(a[i + 1]).toBe('copy')
  })
  it('WHIP muxer 出力（-f whip <target>）', () => {
    const a = buildSfuFfmpegArgs('rtsp://src', 'http://proxy/whip?upstream=x')
    const i = a.indexOf('-f')
    expect(a[i + 1]).toBe('whip')
    expect(a[i + 2]).toBe('http://proxy/whip?upstream=x')
  })
  it('非単調DTS対策 +genpts と 音声なし -an を含む', () => {
    const a = buildSfuFfmpegArgs('rtsp://src', 'http://t')
    expect(a).toContain('+genpts')
    expect(a).toContain('-an')
  })
})
