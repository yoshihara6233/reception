/**
 * F55.E: Hikvision Alert Stream テスト (topic normalize + multipart parse)
 *
 * 注: long-poll ループ自体の統合テストは難しいので、
 * normalize と XML parser 関数の単体テストに留める。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { NvrEvent } from '@intereco/shared'
import { subscribeHikvisionAlertStream } from './alert-stream'

describe('Hikvision Alert Stream', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('multipart レスポンスを解析して motion イベントをコールバック', async () => {
    const xml =
      '\r\nContent-Type: application/xml\r\n\r\n' +
      '<EventNotificationAlert>' +
      '<ipAddress>10.0.1.5</ipAddress>' +
      '<eventType>VMD</eventType>' +
      '<channelID>3</channelID>' +
      '<dateTime>2026-06-04T10:00:00+09:00</dateTime>' +
      '</EventNotificationAlert>\r\n'
    const body = `--MIME_boundary${xml}--MIME_boundary--\r\n`
    const buf = new TextEncoder().encode(body)

    const stream = new ReadableStream({
      start(c) {
        c.enqueue(buf)
        c.close()
      },
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'multipart/mixed; boundary=MIME_boundary' },
      }),
    )

    const received: NvrEvent[] = []
    const sub = await subscribeHikvisionAlertStream(
      {
        endpoint: 'http://10.0.1.5',
        username: 'admin',
        password: 'secret',
        reconnectBackoffMs: [10],
      },
      (evt) => { received.push(evt) },
    )

    // 解析を待つ
    await new Promise((r) => setTimeout(r, 50))
    await sub.unsubscribe()

    expect(received.length).toBeGreaterThanOrEqual(1)
    const motion = received.find((e) => e.type === 'motion')
    expect(motion).toBeDefined()
    expect(motion!.channel).toBe(3)
  })

  it('videoloss イベントを video_loss に正規化', async () => {
    const xml =
      '\r\nContent-Type: application/xml\r\n\r\n' +
      '<EventNotificationAlert>' +
      '<eventType>videoloss</eventType>' +
      '<channelID>2</channelID>' +
      '</EventNotificationAlert>\r\n'
    const body = `--MIME_boundary${xml}--MIME_boundary--\r\n`
    const buf = new TextEncoder().encode(body)

    const stream = new ReadableStream({
      start(c) { c.enqueue(buf); c.close() },
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'multipart/mixed; boundary=MIME_boundary' },
      }),
    )

    const received: NvrEvent[] = []
    const sub = await subscribeHikvisionAlertStream(
      {
        endpoint: 'http://10.0.1.5',
        username: 'admin',
        password: 'secret',
        reconnectBackoffMs: [10],
      },
      (evt) => { received.push(evt) },
    )
    await new Promise((r) => setTimeout(r, 50))
    await sub.unsubscribe()

    const evt = received.find((e) => e.type === 'video_loss')
    expect(evt).toBeDefined()
    expect(evt!.channel).toBe(2)
  })

  it('未知の eventType は無視', async () => {
    const xml =
      '\r\nContent-Type: application/xml\r\n\r\n' +
      '<EventNotificationAlert>' +
      '<eventType>UnknownEvent</eventType>' +
      '<channelID>1</channelID>' +
      '</EventNotificationAlert>\r\n'
    const body = `--MIME_boundary${xml}--MIME_boundary--\r\n`
    const buf = new TextEncoder().encode(body)

    const stream = new ReadableStream({
      start(c) { c.enqueue(buf); c.close() },
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(stream, {
        status: 200,
        headers: { 'content-type': 'multipart/mixed; boundary=MIME_boundary' },
      }),
    )

    const received: NvrEvent[] = []
    const sub = await subscribeHikvisionAlertStream(
      {
        endpoint: 'http://10.0.1.5',
        username: 'admin',
        password: 'secret',
        reconnectBackoffMs: [10],
      },
      (evt) => { received.push(evt) },
    )
    await new Promise((r) => setTimeout(r, 50))
    await sub.unsubscribe()

    expect(received).toHaveLength(0)
  })

  it('HTTP error はリトライ後 unsubscribe で終了', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    )

    const sub = await subscribeHikvisionAlertStream(
      {
        endpoint: 'http://10.0.1.5',
        username: 'admin',
        password: 'wrong',
        reconnectBackoffMs: [10],
      },
      () => {},
    )
    await new Promise((r) => setTimeout(r, 30))
    await sub.unsubscribe()
    // No throw means OK
    expect(true).toBe(true)
  })
})
