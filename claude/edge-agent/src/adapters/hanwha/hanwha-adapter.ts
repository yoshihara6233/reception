/**
 * F52.D: Hanwha Wisenet (SUNAPI) Adapter
 *
 * PRN-1610S2 等の Hanwha (旧サムスン) NVR + Wisenet カメラ対応。
 * SUNAPI 経由で snapshot/RTSP/event を取得。
 *
 * 機能:
 *   - testConnection: /stw-cgi/system.cgi?msubmenu=deviceinfo&action=view
 *   - getSnapshot:    /stw-cgi/video.cgi?msubmenu=snapshot&Channel=N
 *   - getLiveRtspUri: rtsp://<host>:554/profile<N>
 *
 * 制約:
 *   - VOD は SUNAPI search → playback の 2 段 (Phase 6 で実装予定)
 *   - Event push は HTTP Notification (Phase 6 で実装予定)
 *   - ONVIF も多くのモデルでサポート (fallback で onvif-generic も使える)
 */
import type {
  NvrAdapter, NvrAdapterConfig, NvrCapabilities, FirmwareInfo, NvrChannel,
} from '@intereco/shared'
import { CONSERVATIVE_CAPABILITIES, NvrAdapterError } from '@intereco/shared'
import { SunapiClient } from './sunapi-client'

export class HanwhaAdapter implements NvrAdapter {
  readonly vendor = 'hanwha-wisenet' as const
  public readonly firmware:     FirmwareInfo
  public readonly capabilities: NvrCapabilities
  private readonly client: SunapiClient
  private readonly config: NvrAdapterConfig

  constructor(
    config:       NvrAdapterConfig,
    firmware:     FirmwareInfo,
    capabilities: NvrCapabilities,
    client?:      SunapiClient,
  ) {
    this.config = config
    this.firmware = firmware
    this.capabilities = capabilities
    this.client = client ?? new SunapiClient({
      endpoint: config.endpoint,
      username: config.credentials.username,
      password: config.credentials.password,
      timeoutMs: config.timeoutMs,
      rateLimitMs: capabilities.rateLimitMs,
    })
  }

  async testConnection(): Promise<boolean> {
    if (this.firmware.modelFamily === 'unknown') return false
    try {
      const res = await this.client.get('/stw-cgi/system.cgi', {
        msubmenu: 'deviceinfo', action: 'view',
      })
      return res.status === 200 && res.text.length > 0
    } catch {
      return false
    }
  }

  async getChannelList(): Promise<NvrChannel[]> {
    // SUNAPI には /stw-cgi/network.cgi?msubmenu=ChannelInfo もあるが、
    // Phase 5 では capability.maxChannels で生成 (Phase 6 で動的取得に切替)
    const list: NvrChannel[] = []
    for (let i = 1; i <= this.capabilities.maxChannels; i++) {
      list.push({
        index:   i,
        name:    `CH${String(i).padStart(2, '0')}`,
        enabled: true,
      })
    }
    return list
  }

  async getSnapshot(channel: number): Promise<Buffer> {
    this.validateChannel(channel)
    const res = await this.client.get('/stw-cgi/video.cgi', {
      msubmenu: 'snapshot', action: 'view',
      Channel:  channel,
    })
    if (res.body.length < 2 || res.body[0] !== 0xff || res.body[1] !== 0xd8) {
      throw new NvrAdapterError(this.vendor, 'protocol_error',
        `Hanwha snapshot is not a JPEG (${res.body.length} bytes)`)
    }
    return res.body
  }

  async getLiveRtspUri(channel: number, stream: 'main' | 'sub' = 'main'): Promise<string> {
    this.validateChannel(channel)
    // Hanwha RTSP: rtsp://user:pass@host:554/profile<N>/media.smp
    //   profile<N> は機種・設定依存。一般的に 1=メイン, 2=サブ
    //   channel × stream で計算: NVR は channel 単位、IP カメラは host 単位
    const { host } = this.parseEndpoint()
    const rtspPort = (this.config.options.rtsp_port as number | undefined) ?? 554
    const auth = `${encodeURIComponent(this.config.credentials.username)}:` +
                 `${encodeURIComponent(this.config.credentials.password)}`

    // NVR の場合は profile N: channel = 1〜16, sub = +100
    //   例: channel 3 main = profile3, channel 3 sub = profile103
    // IP カメラ単体の場合は profile1/profile2
    const profileNum = stream === 'sub' ? channel + 100 : channel
    return `rtsp://${auth}@${host}:${rtspPort}/profile${profileNum}/media.smp`
  }

  async getVodMp4(channel: number, from: Date, to: Date): Promise<NodeJS.ReadableStream> {
    // F53.B: Hanwha SUNAPI VOD MP4 実装
    // 2 段階:
    //   1. /stw-cgi/recording.cgi?msubmenu=search&action=view&Channel=N&FromDate=...&ToDate=...
    //      → 録画セッション一覧を取得
    //   2. /stw-cgi/recording.cgi?msubmenu=playback&action=control&...
    //      → MP4 ストリーミング (一部機種は backupmanager.cgi 経由)
    this.validateChannel(channel)

    const hours = (to.getTime() - from.getTime()) / 3_600_000
    if (hours > this.capabilities.maxVodHours) {
      throw new NvrAdapterError(this.vendor, 'unsupported',
        `requested ${hours.toFixed(1)}h exceeds max ${this.capabilities.maxVodHours}h`)
    }

    // 1. 録画検索
    const searchRes = await this.client.get('/stw-cgi/recording.cgi', {
      msubmenu: 'search', action: 'view',
      Channel:  channel,
      FromDate: toSunapiTime(from),
      ToDate:   toSunapiTime(to),
    })

    // SUNAPI 応答は JSON or XML、両方対応
    const hasMatches =
      /"NumberOfItems"\s*:\s*[1-9]/.test(searchRes.text) ||   // JSON
      /<NumberOfItems>[1-9]/.test(searchRes.text)            // XML
    if (!hasMatches) {
      throw new NvrAdapterError(this.vendor, 'not_found',
        `no recordings for ch${channel} between ${from.toISOString()} and ${to.toISOString()}`)
    }

    // 2. backup (export) を要求 — 機種により API パスが異なるため複数試行
    // 主要パス: /stw-cgi/backup.cgi?msubmenu=backup&action=create&Channel=...
    const { host, port } = this.parseEndpoint()
    const sec = (d: Date) => Math.floor(d.getTime() / 1000)
    const backupUrl = `${this.config.endpoint.replace(/\/+$/, '')}` +
      `/stw-cgi/backup.cgi?msubmenu=backup&action=create` +
      `&Channel=${channel}` +
      `&StartTime=${sec(from)}&EndTime=${sec(to)}` +
      `&FileFormat=MP4`

    const auth = 'Basic ' + Buffer.from(
      `${this.config.credentials.username}:${this.config.credentials.password}`,
    ).toString('base64')
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 60_000)
    try {
      void host; void port
      const res = await fetch(backupUrl, {
        headers: { authorization: auth },
        signal:  ctl.signal,
      })
      if (!res.ok || !res.body) {
        throw new NvrAdapterError(this.vendor, 'transient',
          `Hanwha VOD backup HTTP ${res.status}`)
      }
      const { Readable } = await import('stream')
      return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    } finally {
      clearTimeout(timer)
    }
  }

  async dispose(): Promise<void> { /* no-op */ }

  // ─── helpers ───────────────────────────────────────────────────────────

  private parseEndpoint(): { host: string; port: number } {
    try {
      const u = new URL(this.config.endpoint)
      return { host: u.hostname, port: u.port ? parseInt(u.port, 10) : 80 }
    } catch {
      return { host: this.config.endpoint.replace(/^https?:\/\//, '').split(':')[0], port: 80 }
    }
  }

  private validateChannel(channel: number): void {
    if (channel < 1 || channel > this.capabilities.maxChannels) {
      throw new NvrAdapterError(this.vendor, 'channel_unavailable',
        `channel ${channel} out of range (1..${this.capabilities.maxChannels})`)
    }
  }
}

// ─── ファクトリ ──────────────────────────────────────────────────────────────

export async function createHanwhaAdapter(
  config: NvrAdapterConfig,
): Promise<NvrAdapter> {
  let firmware: FirmwareInfo
  try {
    const client = new SunapiClient({
      endpoint: config.endpoint,
      username: config.credentials.username,
      password: config.credentials.password,
      timeoutMs: config.timeoutMs ?? 5000,
    })
    const res = await client.get('/stw-cgi/system.cgi', { msubmenu: 'deviceinfo', action: 'view' })
    // SUNAPI 応答は JSON or XML、機種により異なる。両方対応する正規表現アプローチ
    const text = res.text
    const model =
      (text.match(/"Model"\s*:\s*"([^"]+)"/) ?? [])[1] ??
      (text.match(/<Model>([^<]+)<\/Model>/) ?? [])[1] ??
      'unknown'
    const fw =
      (text.match(/"FirmwareVersion"\s*:\s*"([^"]+)"/) ?? [])[1] ??
      (text.match(/<FirmwareVersion>([^<]+)<\/FirmwareVersion>/) ?? [])[1] ??
      '0.0.0'
    const serial =
      (text.match(/"SerialNumber"\s*:\s*"([^"]+)"/) ?? [])[1] ??
      (text.match(/<SerialNumber>([^<]+)<\/SerialNumber>/) ?? [])[1]
    const { major, minor, patch } = parseHanwhaFw(fw)
    firmware = {
      vendor:       'hanwha-wisenet',
      modelFamily:  inferHanwhaFamily(model),
      modelNumber:  model,
      fwVersion:    fw,
      fwMajor:      major,
      fwMinor:      minor,
      fwPatch:      patch,
      serial,
      detectedAt:   new Date(),
      source:       'cgi',
    }
  } catch {
    firmware = {
      vendor:      'hanwha-wisenet', modelFamily: 'unknown', modelNumber: 'unknown',
      fwVersion: '0.0.0', fwMajor: 0, fwMinor: 0, fwPatch: 0,
      detectedAt: new Date(), source: 'header',
    }
  }

  const capabilities: NvrCapabilities = {
    ...CONSERVATIVE_CAPABILITIES,
    protocol:                 ['cgi', 'onvif'],
    authMethod:               'digest',
    supportsSnapshot:         true,
    supportsLiveRtsp:         true,
    supportsLiveJpegPull:     true,
    supportsVod:              true,   // Phase 6 で実装
    vodFormats:               ['mp4'],
    maxVodHours:              24,
    supportsEventPush:        true,
    supportsOnvifPullPoint:   true,
    supportsAiMetadata:       firmware.modelFamily === 'wisenet_ai',
    supportsMotionZone:       true,
    supportedCodecs:          ['h264', 'h265'],
    maxResolution:            '4K',
    maxChannels:              16,
    eventTypes:               ['motion', 'video_loss', 'tampering'],
    maxConcurrentSessions:    8,
    rateLimitMs:              250,
  }

  if (firmware.modelFamily === 'wisenet_ai') {
    capabilities.eventTypes.push('ai_person', 'ai_vehicle')
  }

  return new HanwhaAdapter(config, firmware, capabilities)
}

// F53.B: SUNAPI 時刻フォーマット (YYYY-MM-DDTHH:mm:ssZ)
function toSunapiTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function parseHanwhaFw(s: string): { major: number; minor: number; patch: number } {
  const m = s.match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!m) return { major: 0, minor: 0, patch: 0 }
  return {
    major: parseInt(m[1], 10), minor: parseInt(m[2], 10), patch: parseInt(m[3] ?? '0', 10),
  }
}

function inferHanwhaFamily(model: string): string {
  const m = model.toUpperCase()
  if (m.startsWith('PRN-'))   return 'nvr_pro'
  if (m.startsWith('XRN-'))   return 'nvr_xrn'
  if (m.startsWith('PNV-')   || m.startsWith('PNB-') || m.startsWith('PNM-')) return 'ip_camera'
  if (m.includes('AI') || m.includes('PNV-A'))   return 'wisenet_ai'
  return 'unknown'
}
