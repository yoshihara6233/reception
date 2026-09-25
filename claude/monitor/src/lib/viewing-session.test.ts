import { afterEach, describe, expect, it, vi } from 'vitest'
import { acceptStartedSession, endOnPageHide } from './viewing-session'

function startRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('acceptStartedSession', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('画面が開いていればセッションを返し、終了は送らない', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const s = await acceptStartedSession(startRes({ id: 's1', maxSessionMin: 120 }), () => false)
    expect(s).toEqual({ id: 's1', maxSessionMin: 120 })
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
