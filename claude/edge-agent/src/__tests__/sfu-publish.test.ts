import { describe, it, expect } from 'vitest'
import { go2rtcRtspUrl, buildSfuFfmpegArgs, buildSfuFfmpegArgsVaapi } from '../modes/sfu-publish-core.js'

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
  it('WebRTC互換の baseline H.264 へ変換', () => {
    const a = buildSfuFfmpegArgs('rtsp://src', 'http://proxy/whip?upstream=x')
    const i = a.indexOf('-c:v')
    expect(a[i + 1]).toBe('libx264')
    const p = a.indexOf('-profile:v')
    expect(a[p + 1]).toBe('baseline')
  })
  it('WHIP 出力（-f whip <target>）', () => {
    const a = buildSfuFfmpegArgs('rtsp://src', 'http://proxy/whip?upstream=x')
    const i = a.indexOf('-f')
    expect(a[i + 1]).toBe('whip')
    expect(a[i + 2]).toBe('http://proxy/whip?upstream=x')
  })
  it('非単調DTS対策 +genpts と 音声なし -an を含む', () => {
    const a = buildSfuFfmpegArgs('rtsp://src', 'http://t')
    expect(a).toContain('+genpts+nobuffer')
    expect(a).toContain('-an')
  })
  it('低遅延: 入力バッファ無効 (+nobuffer / low_delay)', () => {
    const a = buildSfuFfmpegArgs('rtsp://src', 'http://t')
    expect(a).toContain('+genpts+nobuffer')
    const f = a.indexOf('-flags')
    expect(a[f + 1]).toBe('low_delay')
    // 入力オプションなので -i より前
    expect(f).toBeLessThan(a.indexOf('-i'))
  })
})

describe('buildSfuFfmpegArgsVaapi', () => {
  it('GPU デコード＋h264_vaapi エンコード＋指定デバイス', () => {
    const a = buildSfuFfmpegArgsVaapi('rtsp://src', 'http://t', '/dev/dri/renderD128')
    expect(a).toContain('h264_vaapi')
    const d = a.indexOf('-hwaccel_device')
    expect(a[d + 1]).toBe('/dev/dri/renderD128')
    // hwaccel は入力オプション: -i より前
    expect(a.indexOf('-hwaccel')).toBeLessThan(a.indexOf('-i'))
  })
  it('WebRTC 互換: constrained_baseline かつ B-frame なし', () => {
    const a = buildSfuFfmpegArgsVaapi('rtsp://src', 'http://t', '/dev/dri/renderD128')
    const p = a.indexOf('-profile:v')
    expect(a[p + 1]).toBe('constrained_baseline')
    const bf = a.indexOf('-bf')
    expect(a[bf + 1]).toBe('0')
  })
  it('WHIP 出力と UDP バッファ拡大は libx264 版と同じ', () => {
    const a = buildSfuFfmpegArgsVaapi('rtsp://src', 'http://t', '/dev/dri/renderD128')
    const f = a.indexOf('-f')
    expect(a[f + 1]).toBe('whip')
    expect(a).toContain('-ts_buffer_size')
    expect(a).toContain('scale_vaapi=w=1280:h=720')
  })
  it('低遅延フラグも libx264 版と同じ', () => {
    const a = buildSfuFfmpegArgsVaapi('rtsp://src', 'http://t', '/dev/dri/renderD128')
    expect(a).toContain('+genpts+nobuffer')
    const f = a.indexOf('-flags')
    expect(a[f + 1]).toBe('low_delay')
  })
})
