/**
 * F55.B: Dahua CGI クライアント
 *
 * Dahua は HTTP CGI ベースの API を提供。Hikvision の ISAPI に近いが、
 * パラメータ形式と認証フローが微妙に違う。
 *
 * 主要エンドポイント:
 *   GET /cgi-bin/magicBox.cgi?action=getDeviceType           — モデル取得
 *   GET /cgi-bin/magicBox.cgi?action=getSoftwareVersion      — FW Ver
 *   GET /cgi-bin/snapshot.cgi?channel=N                      — スナップショット
 *   GET /cgi-bin/mediaFileFind.cgi?action=factory.create     — 録画検索 (StatefulAPI)
 *   GET /cgi-bin/loadfile.cgi?action=startLoad&fileId=...    — VOD ダウンロード
 *
 * RTSP URL:
 *   rtsp://user:pass@host:554/cam/realmonitor?channel=N&subtype=0  (main)
 *   rtsp://user:pass@host:554/cam/realmonitor?channel=N&subtype=1  (sub)
 *
 * 認証: Digest (Hikvision とほぼ同じ実装で動作)
 */
import { createHash, randomBytes } from 'crypto'
import { NvrAdapterError, AuthError } from '@intereco/shared'

export interface DahuaCgiOptions {
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

export interface DahuaCgiResponse {
  status:  number
  body:    Buffer
  text:    string
  headers: Record<string, string>
}

export class DahuaCgiClient {
  private readonly endpoint: string
  private readonly username: string
  private readonly password: string
  private readonly timeoutMs: number
  private readonly rateLimitMs: number
  private lastCallAt = 0
  private digest: DigestState = { nc: 0 }

  constructor(opts: DahuaCgiOptions) {
    this.endpoint    = opts.endpoint.replace(/\/+$/, '')
    this.username    = opts.username
    this.password    = opts.password
    this.timeoutMs   = opts.timeoutMs   ?? 10_000
    this.rateLimitMs = opts.rateLimitMs ?? 0
  }

  async get(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<DahuaCgiResponse> {
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

  private async doRequest(method: 'GET', url: string): Promise<DahuaCgiResponse> {
    const auth1 = this.digest.nonce ? this.buildDigestHeader(method, url) : undefined
    let res = await this.fetchOnce(method, url, auth1)
    if (res.status === 401) {
      const wwwAuth = res.headers.get('www-authenticate') ?? ''
      this.parseDigestChallenge(wwwAuth)
      const auth2 = this.buildDigestHeader(method, url)
      res = await this.fetchOnce(method, url, auth2)
    }
    if (res.status === 401 || res.status === 403) {
      throw new AuthError('dahua', `Dahua HTTP ${res.status}`)
    }
    if (res.status >= 500) {
      throw new NvrAdapterError('dahua', 'transient', `Dahua HTTP ${res.status}`)
    }
    if (!res.ok) {
      throw new NvrAdapterError('dahua', 'protocol_error', `Dahua HTTP ${res.status}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    const headers: Record<string, string> = {}
    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v })
    return { status: res.status, body: buf, text: buf.toString('utf-8'), headers }
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
        throw new NvrAdapterError('dahua', 'timeout', `Dahua timeout: ${url}`)
      }
      throw new NvrAdapterError('dahua', 'transient',
        `Dahua network: ${(err as Error).message}`)
    } finally {
      clearTimeout(timer)
    }
  }

  // ─── Digest (RFC 7616) ─────────────────────────────────────────────────

  private parseDigestChallenge(header: string): void {
    const dict: Record<string, string> = {}
    const stripped = header.replace(/^Digest\s+/i, '')
    const regex = /(\w+)\s*=\s*("([^"]*)"|([^,]+))(?:,|$)/g
    let m: RegExpExecArray | null
    while ((m = regex.exec(stripped))) {
      dict[m[1].toLowerCase()] = m[3] ?? m[4]
    }
    this.digest = {
      nonce:  dict.nonce,  realm:  dict.realm,
      qop:    dict.qop,    opaque: dict.opaque,
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
      `username="${this.username}"`, `realm="${realm}"`,
      `nonce="${nonce}"`, `uri="${uri}"`, `response="${response}"`,
    ]
    if (qop) parts.push(`qop=${qop}`, `nc=${ncStr}`, `cnonce="${cnonce}"`)
    if (opaque) parts.push(`opaque="${opaque}"`)
    return `Digest ${parts.join(', ')}`
  }
}
