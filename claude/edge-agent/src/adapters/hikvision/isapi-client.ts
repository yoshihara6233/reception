/**
 * F52.B: Hikvision ISAPI クライアント
 *
 * ISAPI = Intelligent Security API。Hikvision の HTTP ベース API。
 * 主要エンドポイント:
 *   GET  /ISAPI/System/deviceInfo            — デバイス情報 (XML)
 *   GET  /ISAPI/Streaming/channels           — チャンネル一覧
 *   GET  /ISAPI/Streaming/channels/<N>01/picture — スナップショット (JPEG)
 *   GET  /ISAPI/Streaming/channels/<N>01/httpPreview — MJPEG ストリーム
 *   GET  /ISAPI/ContentMgmt/search           — 録画検索
 *   POST /ISAPI/Event/notification/alertStream — イベントストリーム
 *
 * 認証: Digest auth (RFC 7616)
 *
 * 仕様: https://www.hikvision.com/content/dam/hikvision/en/support/download/isapi.pdf
 *       (公式 PDF。URL は変わる可能性あり)
 */
import { createHash, randomBytes } from 'crypto'
import { NvrAdapterError, AuthError } from '@intereco/shared'

export interface IsapiClientOptions {
  endpoint:    string
  username:    string
  password:    string
  timeoutMs?:  number
  rateLimitMs?: number
}

interface DigestState {
  nonce?:  string
  realm?:  string
  qop?:    string
  opaque?: string
  nc:      number
}

export interface IsapiResponse {
  status:   number
  headers:  Record<string, string>
  body:     Buffer
  text:     string
}

export class IsapiClient {
  private readonly endpoint: string
  private readonly username: string
  private readonly password: string
  private readonly timeoutMs: number
  private readonly rateLimitMs: number
  private lastCallAt = 0
  private digest: DigestState = { nc: 0 }

  constructor(opts: IsapiClientOptions) {
    this.endpoint    = opts.endpoint.replace(/\/+$/, '')
    this.username    = opts.username
    this.password    = opts.password
    this.timeoutMs   = opts.timeoutMs   ?? 10_000
    this.rateLimitMs = opts.rateLimitMs ?? 0
  }

  async get(path: string): Promise<IsapiResponse> {
    await this.throttle()
    return this.doRequest('GET', this.fullUrl(path))
  }

  async post(path: string, body: string, contentType = 'application/xml'): Promise<IsapiResponse> {
    await this.throttle()
    return this.doRequest('POST', this.fullUrl(path), body, contentType)
  }

  // ─── 内部 ───────────────────────────────────────────────────────────────

  private fullUrl(path: string): string {
    return `${this.endpoint}${path.startsWith('/') ? '' : '/'}${path}`
  }

  private async throttle(): Promise<void> {
    if (this.rateLimitMs <= 0) return
    const elapsed = Date.now() - this.lastCallAt
    const wait = this.rateLimitMs - elapsed
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.lastCallAt = Date.now()
  }

  private async doRequest(
    method: 'GET' | 'POST',
    url:    string,
    body?:  string,
    contentType?: string,
  ): Promise<IsapiResponse> {
    const auth1 = this.digest.nonce ? this.buildDigestHeader(method, url) : undefined
    let res = await this.fetchWithTimeout(method, url, auth1, body, contentType)

    // 401 → challenge をパースして再送
    if (res.status === 401) {
      const wwwAuth = res.headers.get('www-authenticate') ?? ''
      this.parseDigestChallenge(wwwAuth)
      const auth2 = this.buildDigestHeader(method, url)
      res = await this.fetchWithTimeout(method, url, auth2, body, contentType)
    }

    if (res.status === 401 || res.status === 403) {
      throw new AuthError('hikvision', `ISAPI HTTP ${res.status}`)
    }
    if (res.status >= 500) {
      throw new NvrAdapterError('hikvision', 'transient', `ISAPI HTTP ${res.status}`)
    }
    if (!res.ok) {
      throw new NvrAdapterError('hikvision', 'protocol_error', `ISAPI HTTP ${res.status}`)
    }

    const buf = Buffer.from(await res.arrayBuffer())
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
    return {
      status:  res.status,
      headers,
      body:    buf,
      text:    buf.toString('utf-8'),
    }
  }

  private async fetchWithTimeout(
    method:      string,
    url:         string,
    auth:        string | undefined,
    body?:       string,
    contentType?: string,
  ): Promise<Response> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const headers: Record<string, string> = {}
      if (auth) headers['authorization'] = auth
      if (body && contentType) headers['content-type'] = contentType
      const res = await fetch(url, { method, headers, body, signal: ctl.signal })
      return res
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new NvrAdapterError('hikvision', 'timeout', `ISAPI timeout: ${url}`)
      }
      throw new NvrAdapterError('hikvision', 'transient',
        `ISAPI network error: ${(err as Error).message}`)
    } finally {
      clearTimeout(timer)
    }
  }

  // ─── Digest auth (RFC 7616) ─────────────────────────────────────────────

  private parseDigestChallenge(header: string): void {
    const dict: Record<string, string> = {}
    const stripped = header.replace(/^Digest\s+/i, '')
    const regex = /(\w+)\s*=\s*("([^"]*)"|([^,]+))(?:,|$)/g
    let m: RegExpExecArray | null
    while ((m = regex.exec(stripped))) {
      dict[m[1].toLowerCase()] = m[3] ?? m[4]
    }
    this.digest = {
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
    const { realm, nonce, qop, opaque } = this.digest
    if (!realm || !nonce) return ''

    const md5 = (s: string) => createHash('md5').update(s).digest('hex')
    const ha1 = md5(`${this.username}:${realm}:${this.password}`)
    const ha2 = md5(`${method}:${uri}`)

    this.digest.nc += 1
    const ncStr = this.digest.nc.toString(16).padStart(8, '0')
    const cnonce = randomBytes(8).toString('hex')

    let response: string
    if (qop) {
      response = md5(`${ha1}:${nonce}:${ncStr}:${cnonce}:${qop}:${ha2}`)
    } else {
      response = md5(`${ha1}:${nonce}:${ha2}`)
    }

    const parts = [
      `username="${this.username}"`,
      `realm="${realm}"`,
      `nonce="${nonce}"`,
      `uri="${uri}"`,
      `response="${response}"`,
    ]
    if (qop) parts.push(`qop=${qop}`, `nc=${ncStr}`, `cnonce="${cnonce}"`)
    if (opaque) parts.push(`opaque="${opaque}"`)
    return `Digest ${parts.join(', ')}`
  }
}
