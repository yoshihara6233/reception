/**
 * F106: HTTP Digest authentication helper tests.
 */
import { describe, it, expect, vi } from 'vitest'
import { digestFetch, DigestAuthError } from './digest-auth.js'

function mockResponse(
  status: number,
  body:   Buffer | string = '',
  headers: Record<string, string> = {},
): Response {
  // Convert Buffer to a fresh Uint8Array to avoid SharedArrayBuffer ambiguity
  const init = typeof body === 'string' ? body : new Uint8Array(body)
  return new Response(init as unknown as Uint8Array | string, { status, headers })
}

function challenge(realm = 'TestRealm', qop = 'auth'): Record<string, string> {
  return {
    'www-authenticate':
      `Digest realm="${realm}", nonce="testnonce123", qop="${qop}", opaque="op42"`,
  }
}

describe('digestFetch', () => {
  it('returns body immediately if server accepts without auth', async () => {
    const fakeFetch = vi.fn().mockResolvedValueOnce(
      mockResponse(200, Buffer.from([0x01, 0x02, 0x03])),
    ) as unknown as typeof fetch

    const body = await digestFetch('http://h/p', {
      username:  'u',
      password:  'p',
      fetchImpl: fakeFetch,
    })
    expect(body).toEqual(Buffer.from([0x01, 0x02, 0x03]))
    expect(fakeFetch).toHaveBeenCalledTimes(1)
  })

  it('handles 401 → re-auth flow and computes Authorization header', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fakeFetch = vi.fn().mockImplementation((u: string, init?: RequestInit) => {
      calls.push({ url: u, init })
      if (calls.length === 1) return Promise.resolve(mockResponse(401, '', challenge()))
      return Promise.resolve(mockResponse(200, Buffer.from([0xff, 0xd8])))
    }) as unknown as typeof fetch

    const body = await digestFetch('http://example.local/cgi/foo?ch=1', {
      username:  'admin',
      password:  's3cret',
      fetchImpl: fakeFetch,
    })
    expect(body).toEqual(Buffer.from([0xff, 0xd8]))
    expect(calls).toHaveLength(2)
    // Second call must carry the Authorization header
    const authHeader = (calls[1].init?.headers as Record<string, string>).Authorization
    expect(authHeader).toMatch(/^Digest /)
    expect(authHeader).toContain('username="admin"')
    expect(authHeader).toContain('realm="TestRealm"')
    expect(authHeader).toContain('nonce="testnonce123"')
    expect(authHeader).toContain('qop=auth')
    expect(authHeader).toContain('uri="/cgi/foo?ch=1"')
  })

  it('throws DigestAuthError on 401 without WWW-Authenticate', async () => {
    const fakeFetch = vi.fn().mockResolvedValueOnce(
      mockResponse(401, ''),
    ) as unknown as typeof fetch

    await expect(digestFetch('http://h/p', {
      username:  'u',
      password:  'p',
      fetchImpl: fakeFetch,
    })).rejects.toThrow(/without WWW-Authenticate/)
  })

  it('throws DigestAuthError when final response is 403', async () => {
    const fakeFetch = vi.fn().mockImplementationOnce(() =>
      Promise.resolve(mockResponse(401, '', challenge())),
    ).mockImplementationOnce(() =>
      Promise.resolve(mockResponse(403, '')),
    ) as unknown as typeof fetch

    try {
      await digestFetch('http://h/p', { username: 'u', password: 'wrong', fetchImpl: fakeFetch })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(DigestAuthError)
      expect((e as DigestAuthError).status).toBe(403)
    }
  })
})
