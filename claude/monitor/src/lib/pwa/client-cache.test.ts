import { describe, expect, it } from 'vitest'
import { clearAuthenticatedCaches, isShareableCachePath, signOutAndLeave, type CacheStorageLike } from './client-cache'

describe('isShareableCachePath', () => {
  it('ビルドの静的ファイル・アイコン・/offline は控えてよい', () => {
    for (const p of ['/_next/static/chunks/app.js', '/_next/static/media/font.woff2', '/icons/icon-192.png', '/favicon.ico', '/offline']) {
      expect(isShareableCachePath(p)).toBe(true)
    }
  })
  it('認証済みの画面・API・画像の受け口は控えない', () => {
    for (const p of ['/', '/stores', '/map', '/alarms', '/stores/abc', '/kiosk/baggage/s1', '/api/edges/x/grid', '/offline/x', '/report.png', '/_next/image']) {
      expect(isShareableCachePath(p)).toBe(false)
    }
  })
})

/** 名前ごとに URL の並びを持つ Cache Storage の代わり。 */
function fakeStorage(init: Record<string, string[]>): { cs: CacheStorageLike; left: () => Record<string, string[]> } {
  const data = new Map(Object.entries(init).map(([k, v]) => [k, [...v]]))
  const cs: CacheStorageLike = {
    keys: async () => [...data.keys()],
    open: async (name) => ({
      keys: async () => (data.get(name) ?? []).map((url) => ({ url })),
      delete: async (req) => {
        const list = data.get(name) ?? []
        const i = list.indexOf(req.url)
        if (i < 0) return false
        list.splice(i, 1)
        return true
      },
    }),
  }
  return { cs, left: () => Object.fromEntries(data) }
}

describe('clearAuthenticatedCaches', () => {
  it('以前の SW が控えた画面の HTML を消し、共有してよいものは残す', async () => {
    const o = 'https://gvms-cloud.com'
    const { cs, left } = fakeStorage({
      'intereco-monitor-v2-f72': [`${o}/`, `${o}/stores`, `${o}/map`, `${o}/offline`, `${o}/alarms?x=1`, `${o}/_next/static/chunks/a.js`],
      'intereco-monitor-v2-f73': [`${o}/offline`, `${o}/icons/icon-96.png`],
    })
    const n = await clearAuthenticatedCaches(cs)
    expect(n).toBe(4)
    expect(left()).toEqual({
      'intereco-monitor-v2-f72': [`${o}/offline`, `${o}/_next/static/chunks/a.js`],
      'intereco-monitor-v2-f73': [`${o}/offline`, `${o}/icons/icon-96.png`],
    })
  })

  it('Cache Storage が無い・壊れていても投げない', async () => {
    expect(await clearAuthenticatedCaches(null)).toBe(0)
    const broken: CacheStorageLike = { keys: async () => { throw new Error('denied') }, open: async () => { throw new Error('x') } }
    expect(await clearAuthenticatedCaches(broken)).toBe(0)
  })
})

describe('signOutAndLeave', () => {
  const never = () => new Promise<never>(() => {})

  it('ログアウトの応答が返らなくても、待つ上限でログインの画面へ移る', async () => {
    const went: string[] = []
    await signOutAndLeave({ logout: never, clear: async () => 0, go: (p) => went.push(p), logoutWaitMs: 20, cacheWaitMs: 20 })
    expect(went).toEqual(['/login'])
  })

  it('控えの片付けが終わらなくても移る', async () => {
    const went: string[] = []
    await signOutAndLeave({ logout: async () => ({}), clear: never, go: (p) => went.push(p), logoutWaitMs: 20, cacheWaitMs: 20 })
    expect(went).toEqual(['/login'])
  })

  it('失効に失敗しても片付けてから移る', async () => {
    const order: string[] = []
    await signOutAndLeave({
      logout: async () => { order.push('logout'); throw new Error('net') },
      clear: async () => { order.push('clear'); return 0 },
      go: (p) => order.push(p),
    })
    expect(order).toEqual(['logout', 'clear', '/login'])
  })
})
