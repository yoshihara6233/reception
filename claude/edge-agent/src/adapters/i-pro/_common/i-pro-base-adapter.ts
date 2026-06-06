/**
 * F46.18: IProBaseAdapter — i-PRO 系の共通基底クラス
 *
 * 全 i-PRO WJ-NX/WJ-NU 機種で同じ実装になる部分を集約。
 * 世代別差分は派生クラス (IProNxV1Adapter / V2 / V3+) で override。
 *
 * 実装する NvrAdapter メソッド:
 *   - testConnection()    → /cgi-bin/getsysteminfo を叩いて成功すれば true
 *   - getSnapshot(ch)     → /cgi-bin/snapshot.cgi?ch=N
 *   - getLiveRtspUri()    → rtsp://user:pass@host:port/MediaInput/h264/stream_X
 *   - getChannelList()    → /cgi-bin/getchannelinfo (v1〜v3+ で形式差あり)
 *   - getVodMp4()         → /cgi-bin/playback (世代別 path) — optional
 *
 * mock 戦略:
 *   - constructor で IProCgiClient を受け取れる (依存性注入)
 *   - テストでは fetch を vi.spyOn でモック化 → 実機なしで挙動検証可能
 */
import type {
  NvrAdapter, NvrAdapterConfig, NvrCapabilities, FirmwareInfo,
  NvrChannel, NvrVendor,
} from '../../_base'
import {
  NvrAdapterError, UnsupportedOperationError,
} from '../../_base'
import { IProCgiClient } from './cgi-client'

export interface IProBaseAdapterDeps {
  /** テスト容易性のため CgiClient を差し込める */
  cgiClient?: IProCgiClient
}

export abstract class IProBaseAdapter implements NvrAdapter {
  /**
   * vendor は派生クラスが constructor 引数で渡す。'i-pro-nx' と 'i-pro-nu' の
   * 区別がここで成立する。literal 'as const' を派生で再宣言すると
   * TypeScript の covariant 制約に引っかかるため、文字列で持つ。
   */
  public readonly vendor:       NvrVendor
  public readonly firmware:     FirmwareInfo
  public readonly capabilities: NvrCapabilities

  protected readonly cgi: IProCgiClient
  protected readonly config: NvrAdapterConfig

  constructor(
    vendor:       NvrVendor,
    config:       NvrAdapterConfig,
    firmware:     FirmwareInfo,
    capabilities: NvrCapabilities,
    deps?:        IProBaseAdapterDeps,
  ) {
    this.vendor = vendor
    this.config = config
    this.firmware = firmware
    this.capabilities = capabilities
    this.cgi = deps?.cgiClient ?? new IProCgiClient({
      endpoint:    config.endpoint,
      credentials: config.credentials,
      timeoutMs:   config.timeoutMs,
      retryCount:  config.retryCount,
      rateLimitMs: capabilities.rateLimitMs,
    })
  }

  // ─── 必須メソッド ───────────────────────────────────────────────────────

  async testConnection(): Promise<boolean> {
    if (this.firmware.modelFamily === 'unknown') return false
    try {
      const res = await this.cgi.get({ path: '/cgi-bin/getsysteminfo' })
      return res.status === 200 && res.type === 'text' && res.body.length > 0
    } catch {
      return false
    }
  }

  async getChannelList(): Promise<NvrChannel[]> {
    // i-PRO の channel 列挙は世代によって path が違うが、共通 fallback で
    // 「capabilities.maxChannels 個の有効チャンネル」を生成する。世代別クラスは
    // より詳細な情報 (camera name 等) を取りに行く際に override する。
    const channels: NvrChannel[] = []
    for (let i = 1; i <= this.capabilities.maxChannels; i++) {
      channels.push({
        index:   i,
        name:    `ch${String(i).padStart(2, '0')}`,
        enabled: true,
      })
    }
    return channels
  }

  async getSnapshot(channel: number): Promise<Buffer> {
    this.validateChannel(channel)
    const res = await this.cgi.get({
      path:   '/cgi-bin/snapshot.cgi',
      params: { ch: channel },
      binary: true,
    })
    if (res.type !== 'binary') {
      throw new NvrAdapterError(this.vendor, 'protocol_error',
        `expected binary response from snapshot.cgi, got ${res.type}`)
    }
    // JPEG magic check (0xFF 0xD8)
    if (res.body.length < 2 || res.body[0] !== 0xff || res.body[1] !== 0xd8) {
      throw new NvrAdapterError(this.vendor, 'protocol_error',
        `snapshot response is not a JPEG (got ${res.body.length} bytes)`)
    }
    return res.body
  }

  async getLiveRtspUri(channel: number, stream: 'main' | 'sub' = 'main'): Promise<string> {
    this.validateChannel(channel)
    // i-PRO NVR の RTSP path 共通形式:
    //   rtsp://user:pass@host:554/MediaInput/h264/ch{NN}_main
    //   rtsp://user:pass@host:554/MediaInput/h264/ch{NN}_sub
    // (世代によって path が異なる場合は派生クラスで override)
    const { host, port } = this.parseEndpointHostPort()
    const rtspPort = this.config.options.rtsp_port as number | undefined ?? 554
    const auth = `${encodeURIComponent(this.config.credentials.username)}:` +
                 `${encodeURIComponent(this.config.credentials.password)}`
    const profile = stream === 'sub' ? 'sub' : 'main'
    const chStr = String(channel).padStart(2, '0')
    void host; void port
    return `rtsp://${auth}@${this.endpointHost}:${rtspPort}/MediaInput/h264/ch${chStr}_${profile}`
  }

  async dispose(): Promise<void> {
    // CgiClient 自体は keep-alive 等を持たないので no-op
  }

  // ─── ヘルパー ───────────────────────────────────────────────────────────

  private get endpointHost(): string {
    return this.parseEndpointHostPort().host
  }

  protected parseEndpointHostPort(): { host: string; port: number } {
    try {
      const url = new URL(this.config.endpoint)
      const port = url.port ? parseInt(url.port, 10) :
                  (url.protocol === 'https:' ? 443 : 80)
      return { host: url.hostname, port }
    } catch {
      // endpoint が URL 形式でない場合は best-effort
      const m = this.config.endpoint.match(/^([^:]+)(?::(\d+))?/)
      return {
        host: m?.[1] ?? this.config.endpoint,
        port: m?.[2] ? parseInt(m[2], 10) : 80,
      }
    }
  }

  protected validateChannel(channel: number): void {
    if (channel < 1 || channel > this.capabilities.maxChannels) {
      throw new NvrAdapterError(this.vendor, 'channel_unavailable',
        `channel ${channel} out of range (1..${this.capabilities.maxChannels})`)
    }
  }

  // ─── 派生クラスでオーバーライドするオプショナル ─────────────────────────

  /**
   * VOD MP4 エクスポート。capability で許可されている世代だけが実装する。
   * デフォルトは「未対応」エラー。
   */
  async getVodMp4(_ch: number, _from: Date, _to: Date): Promise<NodeJS.ReadableStream> {
    throw new UnsupportedOperationError(this.vendor, 'getVodMp4')
  }
}
