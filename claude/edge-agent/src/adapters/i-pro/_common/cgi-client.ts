/**
 * F46.15: i-PRO CGI クライアント基盤
 *
 * 全 i-PRO WJ-NX/NU 系で使う HTTP CGI クライアント。
 * - Digest 認証 (RFC 7616)
 * - 自動 retry (max 2、指数バックオフ)
 * - rateLimitMs に基づくスロットリング
 *
 * 設計: docs/tier3/firmware-capability-matrix.md
 */
import { createHash, randomBytes } from 'crypto'
import type { NvrCredentials } from '../../_base'
import { NvrAdapterError, AuthError } from '../../_base'

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RETRY_COUNT = 2

export interface CgiClientOptions {
  endpoint:     string                // 'https://10.0.1.5:8443'
  credentials:  NvrCredentials
  timeoutMs?:   number                // default 10000
  retryCount?:  number                // default 2
  rateLimitMs?: number                // 連続 call の最小間隔 (default 0)
}

export interface CgiGetOptions {
  path:        string                 // '/cgi-bin/getsysteminfo'
  params?:     Record<string, string | number>
  binary?:     boolean                // true なら Buffer を返す
  signal?:     AbortSignal
}

export type CgiResponse =
  | { type: 'text';   body: string;  status: number; headers: Record<string, string> }
  | { type: 'binary'; body: Buffer;  status: number; headers: Record<string, string> }

/**
 * i-PRO CGI クライアント。
 * vendor 識別子は呼び出し側で渡す (エラー時の vendor 情報に使う)。
 */
export class IProCgiClient {
  private readonly endpoint: string
  private readonly creds: NvrCredentials
  private readonly timeoutMs: number
  private readonly retryCount: number
  private readonly rateLimitMs: number
  private lastCallAt = 0

  // Digest auth 状態 (1 回 nonce を取得したら一定期間使い回す)
  private digestState: {
    nonce?: string
    realm?: string
    qop?: string
    opaque?: string
    nc: number
  } = { nc: 0 }

  constructor(opts: CgiClientOptions) {
    this.endpoint    = opts.endpoint.replace(/\/+$/, '')
    this.creds       = opts.credentials
    this.timeoutMs   = opts.timeoutMs   ?? DEFAULT_TIMEOUT_MS
    this.retryCount  = opts.retryCount  ?? DEFAULT_RETRY_COUNT
    this.rateLimitMs = opts.rateLimitMs ?? 0
  }

  /** GET 呼び出し (テキストレスポンス) */
  async get(opts: CgiGetOptions): Promise<CgiResponse> {
    const url = this.buildUrl(opts.path, opts.params)

    for (let attempt = 0; attempt <= this.retryCount; attempt++) {
      await this.throttle()
      try {
        return await this.doRequest(url, opts.binary ?? false, opts.signal)
      } catch (err) {
        if (attempt < this.retryCount && this.shouldRetry(err)) {
          await this.backoff(attempt)
          continue
        }
        throw err
      }
    }
    /* istanbul ignore next */
    throw new Error('unreachable')
  }

  // ─── 内部実装 ─────────────────────────────────────────────────────────────

  private buildUrl(path: string, params?: Record<string, string | number>): string {
    const url = new URL(path.startsWith('/') ? path : `/${path}`, this.endpoint)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v))
      }
    }
    return url.toString()
  }

  private async throttle(): Promise<void> {
    if (this.rateLimitMs <= 0) return
    const elapsed = Date.now() - this.lastCallAt
    const wait = this.rateLimitMs - elapsed
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait))
    }
    this.lastCallAt = Date.now()
  }

  private async backoff(attempt: number): Promise<void> {
    const wait = Math.min(2000, 200 * Math.pow(2, attempt))
    await new Promise((r) => setTimeout(r, wait))
  }

  private shouldRetry(err: unknown): boolean {
    if (err instanceof NvrAdapterError) return err.isRetryable
    // ネットワークエラー全般は retry 可
    return true
  }

  private async doRequest(
    url:    string,
    binary: boolean,
    signal: AbortSignal | undefined,
  ): Promise<CgiResponse> {
    // 1st request: digest auth を試みる前に Authorization なしで投げて 401 + WWW-Authenticate を取る
    const auth = this.digestState.nonce ? this.buildDigestHeader('GET', url) : undefined
    let res = await this.fetchWithTimeout(url, auth, signal)

    // 401 -> WWW-Authenticate を解析して再送
    if (res.status === 401) {
      const challenge = res.headers.get('www-authenticate')
      if (challenge) {
        this.parseDigestChallenge(challenge)
        const auth2 = this.buildDigestHeader('GET', url)
        res = await this.fetchWithTimeout(url, auth2, signal)
      }
    }

    if (res.status === 401 || res.status === 403) {
      throw new AuthError('i-pro-nx', `HTTP ${res.status} on ${url}`)
    }
    if (res.status === 404) {
      throw new NvrAdapterError('i-pro-nx', 'not_found', `HTTP 404 on ${url}`)
    }
    if (res.status >= 500) {
      throw new NvrAdapterError('i-pro-nx', 'transient', `HTTP ${res.status} on ${url}`)
    }
    if (res.status >= 400) {
      throw new NvrAdapterError('i-pro-nx', 'protocol_error', `HTTP ${res.status} on ${url}`)
    }

    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })

    if (binary) {
      const ab = await res.arrayBuffer()
      return { type: 'binary', body: Buffer.from(ab), status: res.status, headers }
    } else {
      const body = await res.text()
      return { type: 'text', body, status: res.status, headers }
    }
  }

  private async fetchWithTimeout(
    url:    string,
    auth:   string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Response> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs)
    // 呼び出し側からの abort も propagate
    if (signal) {
      if (signal.aborted) ctl.abort()
      else signal.addEventListener('abort', () => ctl.abort(), { once: true })
    }
    try {
      const headers: Record<string, string> = {}
      if (auth) headers['authorization'] = auth
      const res = await fetch(url, { method: 'GET', headers, signal: ctl.signal })
      return res
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new NvrAdapterError('i-pro-nx', 'timeout', `Request timed out: ${url}`, err)
      }
      throw new NvrAdapterError('i-pro-nx', 'transient', `Network error: ${(err as Error).message}`, err)
    } finally {
      clearTimeout(timer)
    }
  }

  // ─── Digest auth (RFC 7616) ──────────────────────────────────────────────

  private parseDigestChallenge(header: string): void {
    // 'Digest realm="...", nonce="...", qop="auth", opaque="..."'
    const dict: Record<string, string> = {}
    const stripped = header.replace(/^Digest\s+/i, '')
    const regex = /(\w+)\s*=\s*("([^"]*)"|([^,]+))(?:,|$)/g
    let m: RegExpExecArray | null
    while ((m = regex.exec(stripped))) {
      dict[m[1].toLowerCase()] = m[3] ?? m[4]
    }
    this.digestState = {
      nonce:  dict.nonce,
      realm:  dict.realm,
      qop:    dict.qop,
      opaque: dict.opaque,
      nc:     0,
    }
  }

  private buildDigestHeader(method: string, urlStr: string): string {
    const url = new URL(urlStr)
    const uri = url.pathname + url.search

    const { realm, nonce, qop, opaque } = this.digestState
    if (!realm || !nonce) {
      // まだ challenge を貰っていない: empty を返して 1st 401 を期待
      return ''
    }

    const md5 = (s: string) => createHash('md5').update(s).digest('hex')
    const ha1 = md5(`${this.creds.username}:${realm}:${this.creds.password}`)
    const ha2 = md5(`${method}:${uri}`)

    this.digestState.nc += 1
    const ncStr = this.digestState.nc.toString(16).padStart(8, '0')
    const cnonce = randomBytes(8).toString('hex')

    let response: string
    if (qop) {
      response = md5(`${ha1}:${nonce}:${ncStr}:${cnonce}:${qop}:${ha2}`)
    } else {
      response = md5(`${ha1}:${nonce}:${ha2}`)
    }

    const parts = [
      `username="${this.creds.username}"`,
      `realm="${realm}"`,
      `nonce="${nonce}"`,
      `uri="${uri}"`,
      `response="${response}"`,
    ]
    if (qop) {
      parts.push(`qop=${qop}`, `nc=${ncStr}`, `cnonce="${cnonce}"`)
    }
    if (opaque) {
      parts.push(`opaque="${opaque}"`)
    }
    return `Digest ${parts.join(', ')}`
  }
}
