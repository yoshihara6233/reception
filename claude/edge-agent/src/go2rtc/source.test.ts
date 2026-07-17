import { describe, expect, test } from 'vitest'
import { buildSource, extractForeignStreamLines, sortStreamLines } from './source.js'

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

const CURRENT_YAML = [
  'log:',
  '  level: info',
  'streams:',
  '  cam_aaaa1111-0000-0000-0000-000000000001: "rtsp://a/1"',
  '  cam_bbbb2222-0000-0000-0000-000000000002: "exec:/usr/bin/ffmpeg -i rtsp://b/2 {output}"',
  '',
].join('\n')

describe('extractForeignStreamLines', () => {
  test('自分の担当外の cam_ 行だけを原文のまま保持する', () => {
    const own = new Set(['cam_aaaa1111-0000-0000-0000-000000000001'])
    expect(extractForeignStreamLines(CURRENT_YAML, own)).toEqual([
      '  cam_bbbb2222-0000-0000-0000-000000000002: "exec:/usr/bin/ffmpeg -i rtsp://b/2 {output}"',
    ])
  })

  test('全部担当なら何も保持しない / 空ファイルは空', () => {
    const own = new Set([
      'cam_aaaa1111-0000-0000-0000-000000000001',
      'cam_bbbb2222-0000-0000-0000-000000000002',
    ])
    expect(extractForeignStreamLines(CURRENT_YAML, own)).toEqual([])
    expect(extractForeignStreamLines('', new Set())).toEqual([])
  })

  test('streams 以外の行（log/rtsp等）は拾わない', () => {
    expect(extractForeignStreamLines(CURRENT_YAML, new Set())).toHaveLength(2)
  })
})

describe('sortStreamLines', () => {
  test('名前順で決定的（複数エージェントの書き込みピンポン防止）', () => {
    const a = '  cam_aaaa: "rtsp://a"'
    const b = '  cam_bbbb: "rtsp://b"'
    expect(sortStreamLines([b, a])).toEqual([a, b])
    expect(sortStreamLines([a, b])).toEqual([a, b])
  })
})
