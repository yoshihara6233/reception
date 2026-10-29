/**
 * public/sw-v2.js を、Service Worker の環境の代わり (self・caches・fetch) の中で動かして確かめる。
 * 画面遷移の応答を控えないこと・圏外で /offline を返すこと・共有してよいものだけを控えること
 * (2026-10-29・自主診断 ASVS 14.3.1・14.3.3)。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isShareableCachePath } from './client-cache'

const SW_SOURCE = readFileSync(fileURLToPath(new URL('../../../public/sw-v2.js', import.meta.url)), 'utf8')
const ORIGIN = 'https://gvms-cloud.com'

type Handler = (event: unknown) => void

function loadSw(fetchImpl: (req: Request | string) => Promise<Response>) {
  const handlers = new Map<string, Handler>()
  const stores = new Map<string, Map<string, Response>>()
  const keyOf = (req: Request | string) => (typeof req === 'string' ? new URL(req, ORIGIN).href : req.url)
  const cacheOf = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const m = stores.get(name)!
    return {
      put: async (req: Request | string, res: Response) => { m.set(keyOf(req), res) },
      add: async (req: string) => { const r = await fetchImpl(new URL(req, ORIGIN).href); m.set(keyOf(req), r) },
      addAll: async (list: string[]) => { for (const p of list) { const r = await fetchImpl(new URL(p, ORIGIN).href); m.set(keyOf(p), r) } },
      match: async (req: Request | string) => m.get(keyOf(req))?.clone(),
    }
  }
  const caches = {
    open: async (name: string) => cacheOf(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (req: Request | string) => {
      for (const m of stores.values()) { const r = m.get(keyOf(req)); if (r) return r.clone() }
      return undefined
    },
  }
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type: string, h: Handler) => { handlers.set(type, h) },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    registration: {},
  }
  new Function('self', 'caches', 'fetch', SW_SOURCE)(self, caches, fetchImpl)

  async function install() {
    let p: Promise<unknown> = Promise.resolve()
    handlers.get('install')!({ waitUntil: (x: Promise<unknown>) => { p = x } })
    await p
  }
  /** fetch のイベントを送り、SW が応答したらその応答、素通しなら null。 */
  async function dispatch(path: string, mode: RequestMode | 'navigate'): Promise<Response | null> {
    let responded: Promise<Response> | null = null
    const request = { url: `${ORIGIN}${path}`, method: 'GET', mode }
    handlers.get('fetch')!({ request, respondWith: (r: Promise<Response>) => { responded = r } })
    return responded ? await responded : null
  }
  const cachedUrls = () => [...stores.values()].flatMap((m) => [...m.keys()].map((u) => new URL(u).pathname))
  return { install, dispatch, cachedUrls }
}

const OFFLINE_HTML = '<html><script src="/_next/static/chunks/offline-1.js"></script>' +
  '<script>self.__next_f.push([1,"\\"/_next/static/chunks/offline-2.js\\""])</script>オフラインの画面</html>'

function online(req: Request | string): Promise<Response> {
  const url = typeof req === 'string' ? req : req.url
  const path = new URL(url).pathname
  if (path === '/offline') return Promise.resolve(new Response(OFFLINE_HTML, { headers: { 'content-type': 'text/html' } }))
  return Promise.resolve(new Response(`body of ${path}`, { status: 200 }))
}

describe('sw-v2.js', () => {
  it('install で先に取り込むのは /offline とその静的ファイルだけ (認証済みの画面を取り込まない)', async () => {
    const sw = loadSw(online)
    await sw.install()
    expect(sw.cachedUrls().sort()).toEqual(['/_next/static/chunks/offline-1.js', '/_next/static/chunks/offline-2.js', '/offline'])
  })

  it('画面遷移の応答は控えない', async () => {
    const sw = loadSw(online)
    await sw.install()
    for (const p of ['/', '/stores', '/map', '/alarms', '/kiosk/baggage/s1']) {
      const res = await sw.dispatch(p, 'navigate')
      expect(await res!.text()).toBe(`body of ${p}`)
    }
    expect(sw.cachedUrls().every((p) => isShareableCachePath(p))).toBe(true)
  })

  it('圏外の画面遷移は、前に見た画面ではなく /offline を返す', async () => {
    let up = true
    const sw = loadSw((req) => (up ? online(req) : Promise.reject(new TypeError('offline'))))
    await sw.install()
    await sw.dispatch('/stores', 'navigate')
    up = false
    const res = await sw.dispatch('/stores', 'navigate')
    expect(await res!.text()).toContain('オフラインの画面')
  })

  it('静的ファイルは控え、API と画面の部品の取得 (RSC) は素通し', async () => {
    const sw = loadSw(online)
    await sw.install()
    expect(await sw.dispatch('/_next/static/chunks/app.js', 'no-cors')).not.toBeNull()
    expect(await sw.dispatch('/icons/icon-96.png', 'no-cors')).not.toBeNull()
    expect(await sw.dispatch('/api/edges/x/grid', 'cors')).toBeNull()
    expect(await sw.dispatch('/stores?_rsc=abc', 'cors')).toBeNull()
    expect(sw.cachedUrls()).toContain('/_next/static/chunks/app.js')
    expect(sw.cachedUrls()).not.toContain('/stores')
  })
})
