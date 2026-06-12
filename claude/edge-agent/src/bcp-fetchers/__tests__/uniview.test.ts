/**
 * F106: Uniview BCP snapshot fetcher tests.
 *
 * Verifies:
 *   - LAPI snapshot endpoint URL shape
 *   - Digest auth round-trip
 *   - source='latest' even when at=Date(past) (degraded since LAPI has no
 *     time-indexed endpoint)
 */
import { describe, it, expect, vi } from 'vitest'
import { fetchUniviewSnapshot } from '../uniview.js'

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
      'Digest realm="Uniview LAPI", nonce="xyz789", qop="auth", opaque="uv01"',
  }
}

describe('fetchUniviewSnapshot', () => {
  it('① latest snapshot hits /LAPI/V1.0/Channels/<ch>/Media/Video/Snapshot', async () => {
    const calls: string[] = []
    const fakeFetch = vi.fn().mockImplementation((u: string) => {
      calls.push(u)
      if (calls.length === 1) return Promise.resolve(mockResponse(401, '', digestChallengeHeaders()))
      return Promise.resolve(mockResponse(200, JPEG_MAGIC))
    }) as unknown as typeof fetch

    const result = await fetchUniviewSnapshot({
      host:      '192.168.1.60',
      username:  'admin',
      password:  '123456',
      channel:   5,
      fetchImpl: fakeFetch,
    })

    expect(result.source).toBe('latest')
    expect(result.body[0]).toBe(0xff)
    expect(result.body[1]).toBe(0xd8)
    expect(calls[0]).toContain('/LAPI/V1.0/Channels/5/Media/Video/Snapshot')
  })

  it('② past-instant request still returns source=latest (LAPI degrade)', async () => {
    const fakeFetch = vi.fn().mockImplementationOnce(() =>
      Promise.resolve(mockResponse(401, '', digestChallengeHeaders())),
    ).mockImplementationOnce(() =>
      Promise.resolve(mockResponse(200, JPEG_MAGIC)),
    ) as unknown as typeof fetch

    const result = await fetchUniviewSnapshot({
      host:      '192.168.1.60',
      username:  'admin',
      password:  '123456',
      channel:   1,
      at:        new Date('2026-06-08T11:00:00Z'),
      fetchImpl: fakeFetch,
    })

    // BCP records this as "latest" so consumers know the timeline cell
    // shows current frame, not the historical one.
    expect(result.source).toBe('latest')
  })

  it('throws when response is not a JPEG', async () => {
    const fakeFetch = vi.fn().mockImplementationOnce(() =>
      Promise.resolve(mockResponse(401, '', digestChallengeHeaders())),
    ).mockImplementationOnce(() =>
      Promise.resolve(mockResponse(200, Buffer.from('<html>err</html>'))),
    ) as unknown as typeof fetch

    await expect(fetchUniviewSnapshot({
      host:      '192.168.1.60',
      username:  'admin',
      password:  '123456',
      channel:   1,
      fetchImpl: fakeFetch,
    })).rejects.toThrow(/not a JPEG/)
  })
})
