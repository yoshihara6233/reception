import { afterEach, describe, expect, it, vi } from 'vitest'

describe('cookie-names (__Host- / __Secure- の接頭辞)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it('本番のビルドでは接頭辞を付け、読むときは以前の名前も見る', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const m = await import('./cookie-names')
    expect(m.hostCookieName('bgk_session')).toBe('__Host-bgk_session')
    expect(m.secureCookieName('lp_x')).toBe('__Secure-lp_x')
    const jar = (o: Record<string, string>) => ({ get: (n: string) => (n in o ? { value: o[n] } : undefined) })
    expect(m.readHostCookie(jar({ '__Host-bgk_session': 'new', bgk_session: 'old' }), 'bgk_session')).toBe('new')
    expect(m.readHostCookie(jar({ bgk_session: 'old' }), 'bgk_session')).toBe('old')   // 切り替えた直後のキオスク
  })

  it('開発では付けない (http://localhost で Secure の Cookie を置けないことがある)', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const m = await import('./cookie-names')
    expect(m.hostCookieName('acting_tenant')).toBe('acting_tenant')
  })

  it('本番のセッションの Cookie は __Host- の名前で Secure', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { SESSION_COOKIE_OPTIONS } = await import('@/lib/supabase/cookie-options')
    expect(SESSION_COOKIE_OPTIONS.name).toBe('__Host-gvms-auth')
    expect(SESSION_COOKIE_OPTIONS.secure).toBe(true)
    expect(SESSION_COOKIE_OPTIONS.path).toBe('/')
  })
})
