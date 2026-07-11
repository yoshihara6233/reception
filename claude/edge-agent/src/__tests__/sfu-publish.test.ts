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
  it('H.264 へ変換（-c:v libx264・zerolatency）', () => {
    const a = buildSfuFfmpegArgs('rtsp://src', 'rtmp://ingress/x/key')
    const i = a.indexOf('-c:v')
    expect(a[i + 1]).toBe('libx264')
    expect(a).toContain('zerolatency')
  })
  it('RTMP(FLV) 出力（-f flv <publishUrl>）', () => {
    const a = buildSfuFfmpegArgs('rtsp://src', 'rtmp://ingress/x/key')
    const i = a.indexOf('-f')
    expect(a[i + 1]).toBe('flv')
    expect(a[i + 2]).toBe('rtmp://ingress/x/key')
  })
  it('非単調DTS対策 +genpts と 音声なし -an を含む', () => {
    const a = buildSfuFfmpegArgs('rtsp://src', 'rtmp://t')
    expect(a).toContain('+genpts')
    expect(a).toContain('-an')
  })
})
