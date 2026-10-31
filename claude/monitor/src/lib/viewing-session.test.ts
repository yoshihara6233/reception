import { afterEach, describe, expect, it, vi } from 'vitest'
import { acceptStartedSession, endOnPageHide, startViewingHeartbeat, VIEWING_HEARTBEAT_MS } from './viewing-session'

function startRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('acceptStartedSession', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('画面が開いていればセッションを返し、終了は送らない', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const s = await acceptStartedSession(startRes({ id: 's1' }), () => false)
    expect(s).toEqual({ id: 's1' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('応答の前に画面を離れていたら、できたセッションをその場で終わらせる（枠を残さない）', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const s = await acceptStartedSession(startRes({ id: 's2' }), () => true)
    expect(s).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/sessions')
    expect(JSON.parse(init.body as string)).toEqual({ action: 'end', id: 's2' })
    expect(init.keepalive).toBe(true)
  })

  it('失敗の応答・id の無い応答は null（終了も送らない）', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await acceptStartedSession(startRes({ error: 'x' }, 500), () => true)).toBeNull()
    expect(await acceptStartedSession(startRes({}), () => true)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('endOnPageHide', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('pagehide で呼び、解除後は呼ばない', () => {
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    const end = vi.fn()
    const off = endOnPageHide(end)
    target.dispatchEvent(new Event('pagehide'))
    expect(end).toHaveBeenCalledTimes(1)
    off()
    target.dispatchEvent(new Event('pagehide'))
    expect(end).toHaveBeenCalledTimes(1)
  })
})

describe('startViewingHeartbeat', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('1 分ごとに今のセッションの生存を知らせ、解除したら止まる', () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    let id: string | null = null
    const off = startViewingHeartbeat(() => id)

    vi.advanceTimersByTime(VIEWING_HEARTBEAT_MS)
    expect(fetchMock).not.toHaveBeenCalled() // まだセッションが無いときは送らない

    id = 's1'
    vi.advanceTimersByTime(VIEWING_HEARTBEAT_MS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/sessions')
    expect(JSON.parse(String(init.body))).toEqual({ action: 'heartbeat', id: 's1' })

    off()
    vi.advanceTimersByTime(VIEWING_HEARTBEAT_MS * 3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
