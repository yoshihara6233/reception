import { describe, it, expect } from 'vitest'
import { legacyRedirectTarget } from './legacy-host'

const NEW = 'https://gvms-cloud.com'
const OLD = 'intereco-monitor.vercel.app'

describe('legacyRedirectTarget', () => {
  it('旧 URL の画面は、道と問い合わせを保ったまま新 URL へ', () => {
    expect(legacyRedirectTarget(OLD, '/', '', NEW)).toBe('https://gvms-cloud.com/')
    expect(legacyRedirectTarget(OLD, '/stores/abc', '?tab=live', NEW)).toBe('https://gvms-cloud.com/stores/abc?tab=live')
    // パスワード再設定のリンクは問い合わせにトークンが載る。落とすと再設定できない。
    expect(legacyRedirectTarget(OLD, '/reset-password', '?email=a%40b.jp&token=123456', NEW))
      .toBe('https://gvms-cloud.com/reset-password?email=a%40b.jp&token=123456')
  })

  it('Host の大文字・ポート・末尾のドットは同じ旧 URL とみなす', () => {
    expect(legacyRedirectTarget('Intereco-Monitor.Vercel.App:443', '/login', '', NEW)).toBe('https://gvms-cloud.com/login')
    expect(legacyRedirectTarget(`${OLD}.`, '/login', '', NEW)).toBe('https://gvms-cloud.com/login')
  })

  it('API・キオスク・Service Worker は旧 URL のまま動かす', () => {
    for (const p of ['/api', '/api/edge/heartbeat', '/kiosk', '/kiosk/abc', '/sw.js', '/sw-v2.js']) {
      expect(legacyRedirectTarget(OLD, p, '', NEW)).toBeNull()
    }
    // 接頭辞が同じだけの別の道は転送する。
    expect(legacyRedirectTarget(OLD, '/apix', '', NEW)).toBe('https://gvms-cloud.com/apix')
    expect(legacyRedirectTarget(OLD, '/kiosks', '', NEW)).toBe('https://gvms-cloud.com/kiosks')
  })

  it('新 URL・プレビュー・ローカルは転送しない', () => {
    expect(legacyRedirectTarget('gvms-cloud.com', '/', '', NEW)).toBeNull()
    expect(legacyRedirectTarget('intereco-monitor-git-foo.vercel.app', '/', '', NEW)).toBeNull()
    expect(legacyRedirectTarget('localhost:3000', '/', '', NEW)).toBeNull()
  })

  it('新 URL の設定が旧 URL を指していたら、輪にしない', () => {
    expect(legacyRedirectTarget(OLD, '/', '', `https://${OLD}`)).toBeNull()
  })

  it('道に別のオリジンを書かれても新 URL の外へは出さない', () => {
    const to = legacyRedirectTarget(OLD, '//evil.example/x', '', NEW)
    expect(to).not.toBeNull()
    expect(new URL(to!).hostname).toBe('gvms-cloud.com')
  })
})
