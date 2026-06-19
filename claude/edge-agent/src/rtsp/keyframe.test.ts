import { describe, it, expect } from 'vitest'
import { injectRtspCreds } from './keyframe'

describe('injectRtspCreds', () => {
  it('creds 無しの URL に user:pass を差し込む', () => {
    expect(injectRtspCreds('rtsp://192.168.0.101/ONVIF/MediaInput?profile=def_profile1', 'admin', 'p@ss'))
      .toBe('rtsp://admin:p%40ss@192.168.0.101/ONVIF/MediaInput?profile=def_profile1')
  })

  it('既存の userinfo は置換する', () => {
    expect(injectRtspCreds('rtsp://old:cred@192.168.0.101:554/live', 'new', 'pw'))
      .toBe('rtsp://new:pw@192.168.0.101:554/live')
  })

  it('user が空なら無変更', () => {
    const u = 'rtsp://192.168.0.101/live'
    expect(injectRtspCreds(u, '', '')).toBe(u)
  })

  it('rtsp 以外は無変更', () => {
    const u = 'http://192.168.0.101/snap.jpg'
    expect(injectRtspCreds(u, 'a', 'b')).toBe(u)
  })

  it('パスのスラッシュより前にある @ のみ userinfo とみなす', () => {
    // path に @ を含むが userinfo は無いケース
    const u = 'rtsp://192.168.0.101/path@weird'
    expect(injectRtspCreds(u, 'a', 'b')).toBe('rtsp://a:b@192.168.0.101/path@weird')
  })
})
