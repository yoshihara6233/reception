import { describe, it, expect } from 'vitest'
import {
  makeLiveProxyCookie,
  verifyLiveProxyCookie,
  liveProxyCookieName,
  LIVE_PROXY_COOKIE_TTL_SEC,
} from './live-proxy-session'

const CAM = '26b45a98-b852-44f2-91ed-b00dd5e73adb'
const ORIGIN = 'https://poc-beelink.genesis-edge.com'
const SECRET = 'test-secret'
const NOW = 1_783_850_000_000

describe('live-proxy session cookie', () => {
  it('往復: 生成→検証で origin が戻る', () => {
    const v = makeLiveProxyCookie(CAM, ORIGIN, SECRET, NOW)
    expect(verifyLiveProxyCookie(v, CAM, SECRET, NOW)).toBe(ORIGIN)
  })

  it('TTL内は有効・超過で無効', () => {
    const v = makeLiveProxyCookie(CAM, ORIGIN, SECRET, NOW)
    const justBefore = NOW + (LIVE_PROXY_COOKIE_TTL_SEC - 1) * 1000
    const after      = NOW + (LIVE_PROXY_COOKIE_TTL_SEC + 1) * 1000
    expect(verifyLiveProxyCookie(v, CAM, SECRET, justBefore)).toBe(ORIGIN)
    expect(verifyLiveProxyCookie(v, CAM, SECRET, after)).toBeNull()
  })

  it('別カメラの cookie は無効（cameraId が署名に入る）', () => {
    const v = makeLiveProxyCookie(CAM, ORIGIN, SECRET, NOW)
    expect(verifyLiveProxyCookie(v, 'other-camera-id', SECRET, NOW)).toBeNull()
  })

  it('改竄（origin差し替え・exp延長・署名破壊）は無効', () => {
    const v = makeLiveProxyCookie(CAM, ORIGIN, SECRET, NOW)
    const [exp, , sig] = v.split('.')
    const evilOrigin = Buffer.from('https://evil.example.com').toString('base64url')
    expect(verifyLiveProxyCookie(`${exp}.${evilOrigin}.${sig}`, CAM, SECRET, NOW)).toBeNull()
    const [, originB64] = v.split('.')
    expect(verifyLiveProxyCookie(`${Number(exp) + 9999}.${originB64}.${sig}`, CAM, SECRET, NOW)).toBeNull()
    expect(verifyLiveProxyCookie(`${exp}.${originB64}.AAAA${sig.slice(4)}`, CAM, SECRET, NOW)).toBeNull()
  })

  it('鍵が違えば無効', () => {
    const v = makeLiveProxyCookie(CAM, ORIGIN, SECRET, NOW)
    expect(verifyLiveProxyCookie(v, CAM, 'other-secret', NOW)).toBeNull()
  })

  it('壊れた形式・undefined は無効', () => {
    expect(verifyLiveProxyCookie(undefined, CAM, SECRET, NOW)).toBeNull()
    expect(verifyLiveProxyCookie('garbage', CAM, SECRET, NOW)).toBeNull()
    expect(verifyLiveProxyCookie('a.b', CAM, SECRET, NOW)).toBeNull()
  })

  it('cookie 名はカメラIDから安全な文字だけで構成', () => {
    expect(liveProxyCookieName(CAM)).toBe(`lp_${CAM}`)
    expect(liveProxyCookieName('a/b;c=d')).toBe('lp_abcd')
  })
})
