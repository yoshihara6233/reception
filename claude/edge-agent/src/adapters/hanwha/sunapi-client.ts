/**
 * F52.D: Hanwha Wisenet SUNAPI クライアント
 *
 * SUNAPI = Samsung Unified Network API (旧サムスン由来)。
 * 主要エンドポイント:
 *   GET /stw-cgi/system.cgi?msubmenu=deviceinfo&action=view       — デバイス情報
 *   GET /stw-cgi/video.cgi?msubmenu=snapshot&action=view&Channel=N — スナップショット
 *   GET /stw-cgi/recording.cgi?msubmenu=...&action=search         — 録画検索
 *
 * RTSP:
 *   rtsp://<host>:554/profile<N> (1=メイン, 2=サブ など、プロファイル ID 依存)
 *
 * 認証: Digest auth
 *
 * 仕様: Hanwha 公式 SUNAPI 仕様書 (アカウント要)
 */
import { createHash, randomBytes } from 'crypto'
import { NvrAdapterError, AuthError } from '@intereco/shared'

export interface SunapiClientOptions {
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

export interface SunapiResponse {
  status:  number
  body:    Buffer
  text:    string
}

export class SunapiClient {
  private readonly endpoint: string
  private readonly username: string
  private readonly password: string
  private readonly timeoutMs: number
  private readonly rateLimitMs: number
  private lastCallAt = 0
  private digest: DigestState = { nc: 0 }

  constructor(opts: SunapiClientOptions) {
    this.endpoint    = opts.endpoint.replace(/\/+$/, '')
    this.username    = opts.username
    this.password    = opts.password
    this.timeoutMs   = opts.timeoutMs   ?? 10_000
    this.rateLimitMs = opts.rateLimitMs ?? 0
  }

  /** msubmenu/action ベースの GET */
  async get(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<SunapiResponse> {
    await this.throttle()
    const url = new URL(`${this.endpoint}${path.startsWith('/') ? '' : '/'}${path}`)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    return this.doRequest('GET', url.toString())
  }

  private async throttle(): Promise<void> {
    if (this.rateLimitMs <= 0) return
    const elapsed = Date.now() - this.lastCallAt
    const wait = this.rateLimitMs - elapsed
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.lastCallAt = Date.now()
  }

  private async doRequest(method: 'GET', url: string): Promise<SunapiResponse> {
    const auth1 = this.digest.nonce ? this.buildDigestHeader(method, url) : undefined
    let res = await this.fetchOnce(method, url, auth1)
    if (res.status === 401) {
      const wwwAuth = res.headers.get('www-authenticate') ?? ''
      this.parseDigestChallenge(wwwAuth)
      const auth2 = this.buildDigestHeader(method, url)
      res = await this.fetchOnce(method, url, auth2)
    }
    if (res.status === 401 || res.status === 403) {
      throw new AuthError('hanwha-wisenet', `SUNAPI HTTP ${res.status}`)
    }
    if (res.status >= 500) {
      throw new NvrAdapterError('hanwha-wisenet', 'transient', `SUNAPI HTTP ${res.status}`)
    }
    if (!res.ok) {
      throw new NvrAdapterError('hanwha-wisenet', 'protocol_error', `SUNAPI HTTP ${res.status}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    return { status: res.status, body: buf, text: buf.toString('utf-8') }
  }

  private async fetchOnce(
    method: string, url: string, auth: string | undefined,
  ): Promise<Response> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const headers: Record<string, string> = {}
      if (auth) headers['authorization'] = auth
      const res = await fetch(url, { method, headers, signal: ctl.signal })
      return res
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new NvrAdapterError('hanwha-wisenet', 'timeout', `SUNAPI timeout: ${url}`)
      }
      throw new NvrAdapterError('hanwha-wisenet', 'transient',
        `SUNAPI network: ${(err as Error).message}`)
    } finally {
      clearTimeout(timer)
    }
  }

  // ─── Digest (RFC 7616) — Hikvision クライアントとほぼ同実装 ─────────────

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
    const response = qop
      ? md5(`${ha1}:${nonce}:${ncStr}:${cnonce}:${qop}:${ha2}`)
      : md5(`${ha1}:${nonce}:${ha2}`)
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
