/**
 * F106: i-PRO BCP snapshot fetcher tests.
 *
 * Verifies:
 *   - Latest snapshot path (?ch=N)
 *   - Historical snapshot path (?ch=N&time=<ts>)
 *   - Digest auth round-trip (probe 401 + reauth 200)
 *   - JPEG magic validation
 *   - Channel injection in URL
 */
import { describe, it, expect, vi } from 'vitest'
import { fetchIproSnapshot } from '../ipro.js'

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

function mockResponse(
  status: number,
  body:   Buffer | string = Buffer.alloc(0),
  headers: Record<string, string> = {},
): Response {
  const init = typeof body === 'string' ? body : new Uint8Array(body)
  return new Response(init as unknown as Uint8Array | string, { status, headers })
}

function digestChallengeHeaders(): Record<string, string> {
  return {
    'www-authenticate':
      'Digest realm="i-PRO NVR", nonce="abc123", qop="auth", opaque="op42"',
  }
}

describe('fetchIproSnapshot', () => {
  it('① latest snapshot path includes only ?ch=N', async () => {
    const calls: string[] = []
    const fakeFetch = vi.fn().mockImplementation((u: string) => {
      calls.push(u)
      // First call: probe → 401 with challenge
      if (calls.length === 1) return Promise.resolve(mockResponse(401, '', digestChallengeHeaders()))
      // Second call: authorized → 200 + JPEG
      return Promise.resolve(mockResponse(200, JPEG_MAGIC))
    }) as unknown as typeof fetch

    const result = await fetchIproSnapshot({
      host:      '192.168.1.50',
      username:  'admin',
      password:  's3cret',
      channel:   3,
      at:        null,
      fetchImpl: fakeFetch,
    })

    expect(result.source).toBe('latest')
    expect(result.body[0]).toBe(0xff)
    expect(result.body[1]).toBe(0xd8)
    // URL of either call (they're identical) contains ?ch=3 and NO ?time=
    expect(calls[0]).toContain('/cgi-bin/snapshot.cgi?ch=3')
    expect(calls[0]).not.toContain('time=')
  })

  it('② historical snapshot adds ?time=<unix_ts>', async () => {
    const calls: string[] = []
    const fakeFetch = vi.fn().mockImplementation((u: string) => {
      calls.push(u)
      if (calls.length === 1) return Promise.resolve(mockResponse(401, '', digestChallengeHeaders()))
      return Promise.resolve(mockResponse(200, JPEG_MAGIC))
    }) as unknown as typeof fetch

    const at = new Date('2026-06-08T11:00:00Z') // unix_ts = 1781262000
    const result = await fetchIproSnapshot({
      host:      '192.168.1.50',
      username:  'admin',
      password:  's3cret',
      channel:   3,
      at,
      fetchImpl: fakeFetch,
    })

    expect(result.source).toBe('historical')
    expect(calls[0]).toContain('ch=3')
    expect(calls[0]).toContain(`time=${Math.floor(at.getTime() / 1000)}`)
  })

  it('throws when response is not a JPEG', async () => {
    const fakeFetch = vi.fn().mockImplementationOnce(() =>
      Promise.resolve(mockResponse(401, '', digestChallengeHeaders())),
    ).mockImplementationOnce(() =>
      Promise.resolve(mockResponse(200, Buffer.from('not a jpeg'))),
    ) as unknown as typeof fetch

    await expect(fetchIproSnapshot({
      host:      '192.168.1.50',
      username:  'admin',
      password:  's3cret',
      channel:   1,
      fetchImpl: fakeFetch,
    })).rejects.toThrow(/not a JPEG/)
  })

  it('propagates final 403 (wrong credentials) as DigestAuthError', async () => {
    const fakeFetch = vi.fn().mockImplementationOnce(() =>
      Promise.resolve(mockResponse(401, '', digestChallengeHeaders())),
    ).mockImplementationOnce(() =>
      Promise.resolve(mockResponse(403, '')),
    ) as unknown as typeof fetch

    await expect(fetchIproSnapshot({
      host:      '192.168.1.50',
      username:  'admin',
      password:  'wrong',
      channel:   1,
      fetchImpl: fakeFetch,
    })).rejects.toThrow(/HTTP 403/)
  })
})
