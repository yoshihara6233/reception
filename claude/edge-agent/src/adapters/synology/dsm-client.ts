/**
 * F53.D: Synology DSM Web API クライアント
 *
 * Synology Surveillance Station / DSM の Web API。
 *
 * 認証フロー (SID-based):
 *   1. GET /webapi/auth.cgi?api=SYNO.API.Auth&version=6&method=login
 *           &account=<u>&passwd=<p>&session=SurveillanceStation
 *      → { success: true, data: { sid: "abc123" } }
 *   2. 以降のリクエストには ?_sid=abc123 を付与
 *   3. ログアウト: ?method=logout
 *
 * 主要 API:
 *   GET /webapi/entry.cgi?api=SYNO.SurveillanceStation.Camera
 *       &version=6&method=List   — カメラ一覧
 *   GET /webapi/entry.cgi?api=SYNO.SurveillanceStation.Streaming
 *       &version=1&method=GetSnapshot&cameraId=N
 *   GET /webapi/entry.cgi?api=SYNO.SurveillanceStation.Recording
 *       &version=6&method=List   — 録画検索
 *
 * 仕様: https://global.download.synology.com/download/Document/Software/DeveloperGuide/Package/SurveillanceStation/
 */
import { NvrAdapterError, AuthError } from '@intereco/shared'

export interface DsmClientOptions {
  endpoint:    string             // 'https://nas.local:5001'
  username:    string
  password:    string
  /** Surveillance Station 用セッション名 (デフォルト 'SurveillanceStation') */
  session?:    string
  timeoutMs?:  number
  rateLimitMs?: number
}

export interface DsmApiResponse<T = unknown> {
  success: boolean
  data?:   T
  error?: { code: number; errors?: unknown }
}

export class DsmClient {
  private readonly endpoint: string
  private readonly username: string
  private readonly password: string
  private readonly session: string
  private readonly timeoutMs: number
  private readonly rateLimitMs: number
  private sid: string | null = null
  private lastCallAt = 0

  constructor(opts: DsmClientOptions) {
    this.endpoint    = opts.endpoint.replace(/\/+$/, '')
    this.username    = opts.username
    this.password    = opts.password
    this.session     = opts.session     ?? 'SurveillanceStation'
    this.timeoutMs   = opts.timeoutMs   ?? 10_000
    this.rateLimitMs = opts.rateLimitMs ?? 0
  }

  /** ログイン → SID 取得 */
  async login(): Promise<string> {
    const url = new URL(`${this.endpoint}/webapi/auth.cgi`)
    url.searchParams.set('api',     'SYNO.API.Auth')
    url.searchParams.set('version', '6')
    url.searchParams.set('method',  'login')
    url.searchParams.set('account', this.username)
    url.searchParams.set('passwd',  this.password)
    url.searchParams.set('session', this.session)
    url.searchParams.set('format',  'sid')

    const res = await this.fetchRaw(url.toString())
    const json = await res.json() as DsmApiResponse<{ sid: string }>
    if (!json.success || !json.data?.sid) {
      throw new AuthError('synology-surveillance',
        `DSM login failed (code=${json.error?.code ?? '?'})`)
    }
    this.sid = json.data.sid
    return this.sid
  }

  /** ログアウト */
  async logout(): Promise<void> {
    if (!this.sid) return
    const url = new URL(`${this.endpoint}/webapi/auth.cgi`)
    url.searchParams.set('api',     'SYNO.API.Auth')
    url.searchParams.set('version', '6')
    url.searchParams.set('method',  'logout')
    url.searchParams.set('session', this.session)
    url.searchParams.set('_sid',    this.sid)
    await this.fetchRaw(url.toString()).catch(() => { /* best-effort */ })
    this.sid = null
  }

  /** /webapi/entry.cgi 経由の汎用 API 呼び出し */
  async call<T = unknown>(
    api: string, method: string,
    params: Record<string, string | number> = {},
    version = 1,
  ): Promise<T> {
    await this.throttle()
    if (!this.sid) await this.login()

    const url = new URL(`${this.endpoint}/webapi/entry.cgi`)
    url.searchParams.set('api',     api)
    url.searchParams.set('version', String(version))
    url.searchParams.set('method',  method)
    url.searchParams.set('_sid',    this.sid!)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))

    const res = await this.fetchRaw(url.toString())
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType.startsWith('image/')) {
      // バイナリ応答 (snapshot 等)
      return Buffer.from(await res.arrayBuffer()) as unknown as T
    }
    const json = await res.json() as DsmApiResponse<T>
    if (!json.success) {
      const code = json.error?.code
      if (code === 105 || code === 119) {
        // SID 失効 → 再ログインして再試行
        this.sid = null
        return this.call(api, method, params, version)
      }
      throw new NvrAdapterError('synology-surveillance', 'protocol_error',
        `DSM ${api}.${method} failed (code=${code})`)
    }
    return json.data as T
  }

  private async throttle(): Promise<void> {
    if (this.rateLimitMs <= 0) return
    const elapsed = Date.now() - this.lastCallAt
    const wait = this.rateLimitMs - elapsed
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    this.lastCallAt = Date.now()
  }

  private async fetchRaw(url: string): Promise<Response> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const res = await fetch(url, { signal: ctl.signal })
      if (res.status >= 500) {
        throw new NvrAdapterError('synology-surveillance', 'transient',
          `DSM HTTP ${res.status}`)
      }
      return res
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new NvrAdapterError('synology-surveillance', 'timeout', `DSM timeout`)
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }
}
