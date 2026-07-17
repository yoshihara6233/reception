import { describe, expect, test } from 'vitest'
import { buildSource } from './source.js'

const OPTS = { ffmpegBin: '/usr/bin/ffmpeg', vaapiDevice: '/dev/dri/renderD128' }
const RTSP = 'rtsp://user:pw@192.168.0.102/ONVIF/MediaInput?profile=2_def_profile6'

describe('buildSource', () => {
  test('h264 は素通し。ただし音声トラックは落とす（#media=video）', () => {
    expect(buildSource(RTSP, 'h264', OPTS)).toBe(`${RTSP}#media=video`)
  })

  test('hevc は VAAPI 変換（-an で音声除去・{output} 付き）', () => {
    const src = buildSource(RTSP, 'hevc', OPTS)
    expect(src.startsWith('exec:/usr/bin/ffmpeg')).toBe(true)
    expect(src).toContain('h264_vaapi')
    expect(src).toContain(' -an ')
    expect(src).toContain(RTSP)
    expect(src.endsWith('{output}')).toBe(true)
  })

  test('h265 表記も変換扱い', () => {
    expect(buildSource(RTSP, 'h265', OPTS)).toContain('h264_vaapi')
  })

  test('判定不能(null)は素通しではなく変換に倒す（安全側）', () => {
    expect(buildSource(RTSP, null, OPTS)).toContain('h264_vaapi')
  })

  test('VAAPI デバイス未設定はソフト変換フォールバック', () => {
    expect(buildSource(RTSP, 'hevc', { ffmpegBin: '/usr/bin/ffmpeg', vaapiDevice: '' }))
      .toBe(`ffmpeg:${RTSP}#video=h264`)
  })
})
