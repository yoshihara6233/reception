/**
 * F106: Generic HTTP Digest Authentication helper (RFC 7616 / RFC 2617).
 *
 * Used by BCP snapshot fetchers (i-PRO CGI) and any future
 * vendor that exposes plain HTTP GET endpoints behind Digest auth.
 *
 * Flow:
 *   1. Send GET without Authorization header.
 *   2. Expect 401 + WWW-Authenticate: Digest realm=...,nonce=...,qop=auth,opaque=...
 *   3. Compute response = MD5(HA1:nonce:nc:cnonce:qop:HA2)
 *      where HA1 = MD5(user:realm:pass), HA2 = MD5(method:uri)
 *   4. Re-send with Authorization header and harvest the body bytes.
 *
 * Returns the raw response body as Buffer on 2xx, or throws DigestAuthError
 * on any non-2xx (after auth) or network failure.
 *
 * Algorithm support: MD5 only (the spec also defines SHA-256 / SHA-512-256
 * variants but i-PRO firmware still negotiates MD5 exclusively).
 */
import { createHash, randomBytes } from 'crypto'

export class DigestAuthError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message)
    this.name = 'DigestAuthError'
  }
}

interface DigestChallenge {
  realm:  string
  nonce:  string
  qop:    string
  opaque: string
}

function parseWwwAuthenticate(header: string): DigestChallenge {
  // "Digest realm=\"...\", nonce=\"...\", qop=\"auth\", opaque=\"...\""
  const trimmed = header.replace(/^\s*Digest\s+/i, '')
  const dict: Record<string, string> = {}
  // Match key="value" OR key=value (no quotes)
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(trimmed)) !== null) {
    dict[m[1].toLowerCase()] = m[2] ?? m[3] ?? ''
  }
  if (!dict.nonce || !dict.realm) {
    throw new DigestAuthError(`malformed WWW-Authenticate: ${header.slice(0, 80)}`)
  }
  return {
    realm:  dict.realm,
    nonce:  dict.nonce,
    qop:    dict.qop  ?? 'auth',
    opaque: dict.opaque ?? '',
  }
}

function md5(s: string): string {
  return createHash('md5').update(s).digest('hex')
}

function buildAuthHeader(
  challenge: DigestChallenge,
  method:    string,
  uri:       string,
  username:  string,
  password:  string,
  nc:        string,
  cnonce:    string,
): string {
  const HA1 = md5(`${username}:${challenge.realm}:${password}`)
  const HA2 = md5(`${method}:${uri}`)
  const response = md5(
    `${HA1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${HA2}`,
  )
  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `qop=${challenge.qop}`,
    `nc=${nc}`,
    `cnonce="${cnonce}"`,
    `response="${response}"`,
  ]
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`)
  return `Digest ${parts.join(', ')}`
}

export interface DigestFetchOptions {
  /** Plain credentials. Never logged. */
  username:    string
  password:    string
  /** HTTP method. Defaults to GET. */
  method?:     string
  /** Connection-level timeout. Defaults to 10s (BCP needs to fail fast). */
  timeoutMs?:  number
  /** Optional fetch impl override (used by tests). */
  fetchImpl?:  typeof fetch
}

/**
 * Performs an HTTP Digest authenticated request and returns the response body
 * as Buffer. The 401 → reauth round-trip is encapsulated; callers see a single
 * promise.
 */
export async function digestFetch(
  url:     string,
  opts:    DigestFetchOptions,
): Promise<Buffer> {
  const method    = opts.method ?? 'GET'
  const timeoutMs = opts.timeoutMs ?? 10_000
  const f         = opts.fetchImpl ?? fetch

  const ctrl = new AbortController()
  const t    = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    // Step 1: probe (no auth)
    const probe = await f(url, { method, signal: ctrl.signal })
    if (probe.status >= 200 && probe.status < 300) {
      // Server didn't require auth — just return body
      return Buffer.from(await probe.arrayBuffer())
    }
    if (probe.status !== 401) {
      throw new DigestAuthError(
        `unexpected probe status ${probe.status} (expected 401)`,
        probe.status,
      )
    }
    const wwwAuth = probe.headers.get('www-authenticate')
    if (!wwwAuth) {
      throw new DigestAuthError('401 without WWW-Authenticate header', 401)
    }
    // Drain probe body to free the socket
    await probe.arrayBuffer().catch(() => {})

    // Step 2: compute Authorization header
    const challenge = parseWwwAuthenticate(wwwAuth)
    const uri       = new URL(url).pathname + (new URL(url).search || '')
    const nc        = '00000001'
    const cnonce    = randomBytes(8).toString('hex')
    const auth      = buildAuthHeader(
      challenge, method, uri, opts.username, opts.password, nc, cnonce,
    )

    // Step 3: re-send with auth
    const final = await f(url, {
      method,
      signal:  ctrl.signal,
      headers: { Authorization: auth },
    })
    if (final.status < 200 || final.status >= 300) {
      throw new DigestAuthError(
        `digest fetch failed: HTTP ${final.status}`,
        final.status,
      )
    }
    return Buffer.from(await final.arrayBuffer())
  } finally {
    clearTimeout(t)
  }
}
