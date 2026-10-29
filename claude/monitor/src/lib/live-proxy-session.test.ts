import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  makeLiveProxyCookie,
  verifyLiveProxyCookie,
  liveProxyCookieName,
  LIVE_PROXY_COOKIE_TTL_SEC,
  liveProxyCookieSecret,
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

describe('クッキーの鍵は live-gate の鍵と分ける (ASVS 11.1.2)', () => {
  const saved = { gate: process.env.LIVE_SIGNING_SECRET, own: process.env.LIVE_PROXY_COOKIE_SECRET }
  afterEach(() => {
    if (saved.gate === undefined) delete process.env.LIVE_SIGNING_SECRET
    else process.env.LIVE_SIGNING_SECRET = saved.gate
    if (saved.own === undefined) delete process.env.LIVE_PROXY_COOKIE_SECRET
    else process.env.LIVE_PROXY_COOKIE_SECRET = saved.own
  })

  it('LIVE_PROXY_COOKIE_SECRET があればそれを使う', () => {
    process.env.LIVE_SIGNING_SECRET = 'gate-secret'
    process.env.LIVE_PROXY_COOKIE_SECRET = 'cookie-secret'
    expect(liveProxyCookieSecret()).toBe('cookie-secret')
  })

  it('無ければ LIVE_SIGNING_SECRET から導いた別の鍵 (同じ値は使わない)', () => {
    process.env.LIVE_SIGNING_SECRET = 'gate-secret'
    delete process.env.LIVE_PROXY_COOKIE_SECRET
    const k = liveProxyCookieSecret()
    expect(k).toBeTruthy()
    expect(k).not.toBe('gate-secret')
    // live-gate の鍵で作ったクッキーは通らない (用途が混ざらない)
    const forged = makeLiveProxyCookie(CAM, ORIGIN, 'gate-secret', NOW)
    expect(verifyLiveProxyCookie(forged, CAM, k!, NOW)).toBeNull()
  })

  it('どちらも無ければ null (クッキーを出さず毎回フル認証)', () => {
    delete process.env.LIVE_SIGNING_SECRET
    delete process.env.LIVE_PROXY_COOKIE_SECRET
    expect(liveProxyCookieSecret()).toBeNull()
  })

  it('live-proxy の受け口は LIVE_SIGNING_SECRET を直に読まない', () => {
    const route = readFileSync(
      fileURLToPath(new URL('../app/api/live-proxy/[cameraId]/[...path]/route.ts', import.meta.url)), 'utf8')
    expect(route).not.toMatch(/process\.env\.LIVE_SIGNING_SECRET/)
    expect(route).toMatch(/liveProxyCookieSecret\(\)/)
  })
})
