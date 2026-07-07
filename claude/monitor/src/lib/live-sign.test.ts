import { describe, it, expect, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { buildRemoteMjpegUrl, signLiveUrl } from './live-sign'

afterEach(() => { delete process.env.LIVE_SIGNING_SECRET })

describe('buildRemoteMjpegUrl', () => {
  it('bare host (LAN・スキーム無し) は対象外 → null', () => {
    expect(buildRemoteMjpegUrl('192.168.0.100:5000', 'cam101')).toBeNull()
  })
  it('カメラ未指定 → null', () => {
    expect(buildRemoteMjpegUrl('https://x.example.com', null)).toBeNull()
  })
  it('スキーム付きホストで MJPEG URL を組む', () => {
    expect(buildRemoteMjpegUrl('https://poc.example.com', 'cam101'))
      .toBe('https://poc.example.com/api/cam101?fps=5&height=720')
  })
  it('末尾スラッシュを除去', () => {
    expect(buildRemoteMjpegUrl('https://poc.example.com/', 'cam101'))
      .toBe('https://poc.example.com/api/cam101?fps=5&height=720')
  })
})

describe('signLiveUrl', () => {
  it('鍵未設定なら null（＝従来のCFログイン方式にフォールバック）', () => {
    delete process.env.LIVE_SIGNING_SECRET
    expect(signLiveUrl('https://x.example.com/api/cam101?fps=5')).toBeNull()
  })

  it('Worker の正規化文字列 `${pathname}\\n${exp}` と一致する sig を付与する', () => {
    process.env.LIVE_SIGNING_SECRET = 'testsecret'
    const signed = signLiveUrl('https://poc.example.com/api/cam101?fps=5&height=720', 100)
    expect(signed).not.toBeNull()

    const u = new URL(signed!)
    const exp = u.searchParams.get('exp')!
    const sig = u.searchParams.get('sig')!

    // Worker(web crypto)が同じ正規化文字列で独立に再計算する値と一致するはず。
    const expected = createHmac('sha256', 'testsecret').update(`/api/cam101\n${exp}`).digest('hex')
    expect(sig).toBe(expected)

    expect(Number(exp)).toBeGreaterThan(Math.floor(Date.now() / 1000))
    // 元クエリは保持される（fps/height は署名対象外だが URL には残る）。
    expect(u.searchParams.get('fps')).toBe('5')
    expect(u.searchParams.get('height')).toBe('720')
  })

  it('カメラごとに pathname が異なるため sig も異なる（別カメラ流用不可）', () => {
    process.env.LIVE_SIGNING_SECRET = 'testsecret'
    const a = new URL(signLiveUrl('https://p.example.com/api/camA?fps=5', 100)!)
    const b = new URL(signLiveUrl('https://p.example.com/api/camB?fps=5', 100)!)
    // exp は同秒になり得るので、sig が違うことでカメラ束縛を確認。
    if (a.searchParams.get('exp') === b.searchParams.get('exp')) {
      expect(a.searchParams.get('sig')).not.toBe(b.searchParams.get('sig'))
    }
  })
})
