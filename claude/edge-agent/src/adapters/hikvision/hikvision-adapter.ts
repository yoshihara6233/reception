/**
 * F52.B: Hikvision Adapter
 *
 * DS-7616 系の Hikvision NVR + 直接 IP カメラに対応。
 * ISAPI 経由で snapshot/RTSP/event を取得。
 *
 * 機能:
 *   - testConnection: /ISAPI/System/deviceInfo
 *   - getSnapshot:    /ISAPI/Streaming/channels/<N>01/picture
 *   - getLiveRtspUri: rtsp://<host>:554/Streaming/Channels/<N>01[02]
 *   - getVodMp4:      /ISAPI/ContentMgmt/download (Phase 6 で本実装)
 *   - subscribeEvents: /ISAPI/Event/notification/alertStream (HTTP push)
 *
 * capability:
 *   - AcuSense モデルは AI 検知あり (DS-7616NXI-K2/16P)
 *   - Smart Codec (H.265+) 対応
 *   - 多くのモデルが ONVIF Profile S/T もサポート (fallback で onvif-generic も使える)
 */
import type {
  NvrAdapter, NvrAdapterConfig, NvrCapabilities, FirmwareInfo,
  NvrChannel, NvrEventCallback, NvrEventSubscription,
} from '@intereco/shared'
import { CONSERVATIVE_CAPABILITIES, NvrAdapterError } from '@intereco/shared'
import { subscribeHikvisionAlertStream } from './alert-stream'
import { IsapiClient } from './isapi-client'

export class HikvisionAdapter implements NvrAdapter {
  readonly vendor = 'hikvision' as const
  public readonly firmware:     FirmwareInfo
  public readonly capabilities: NvrCapabilities
  private readonly client: IsapiClient
  private readonly config: NvrAdapterConfig

  constructor(
    config:       NvrAdapterConfig,
    firmware:     FirmwareInfo,
    capabilities: NvrCapabilities,
    client?:      IsapiClient,
  ) {
    this.config = config
    this.firmware = firmware
    this.capabilities = capabilities
    this.client = client ?? new IsapiClient({
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
      const res = await this.client.get('/ISAPI/System/deviceInfo')
      return res.status === 200 && res.text.includes('<deviceName>')
    } catch {
      return false
    }
  }

  async getChannelList(): Promise<NvrChannel[]> {
    // Phase 5: capability の maxChannels から生成
    // Phase 6 で /ISAPI/Streaming/channels から動的取得に切替予定
    const list: NvrChannel[] = []
    for (let i = 1; i <= this.capabilities.maxChannels; i++) {
      list.push({
        index:   i,
        name:    `Camera ${String(i).padStart(2, '0')}`,
        enabled: true,
      })
    }
    return list
  }

  async getSnapshot(channel: number): Promise<Buffer> {
    this.validateChannel(channel)
    const res = await this.client.get(`/ISAPI/Streaming/channels/${channel}01/picture`)
    if (res.body.length < 2 || res.body[0] !== 0xff || res.body[1] !== 0xd8) {
      throw new NvrAdapterError(this.vendor, 'protocol_error',
        `Hikvision snapshot is not a JPEG (${res.body.length} bytes)`)
    }
    return res.body
  }

  async getLiveRtspUri(channel: number, stream: 'main' | 'sub' = 'main'): Promise<string> {
    this.validateChannel(channel)
    // Hikvision RTSP URL: rtsp://user:pass@host:rtspPort/Streaming/Channels/<NN><01|02>
    //   末尾 01 = main stream, 02 = sub stream
    const { host } = this.parseEndpoint()
    const rtspPort = (this.config.options.rtsp_port as number | undefined) ?? 554
    const auth = `${encodeURIComponent(this.config.credentials.username)}:` +
                 `${encodeURIComponent(this.config.credentials.password)}`
    const suffix = stream === 'sub' ? '02' : '01'
    const chStr = String(channel).padStart(2, '0')
    return `rtsp://${auth}@${host}:${rtspPort}/Streaming/Channels/${chStr}${suffix}`
  }

  async getVodMp4(channel: number, from: Date, to: Date): Promise<NodeJS.ReadableStream> {
    // F53.A: Hikvision VOD MP4 実装
    // 2 段階:
    //   1. POST /ISAPI/ContentMgmt/search  - 録画検索、playbackURI を取得
    //   2. GET  <playbackURI>              - MP4 をストリーミング
    this.validateChannel(channel)

    const hours = (to.getTime() - from.getTime()) / 3_600_000
    if (hours > this.capabilities.maxVodHours) {
      throw new NvrAdapterError(this.vendor, 'unsupported',
        `requested ${hours.toFixed(1)}h exceeds max ${this.capabilities.maxVodHours}h`)
    }

    // 1. 録画検索
    const trackId = `${channel}01`
    const searchXml = `<?xml version="1.0" encoding="UTF-8"?>
<CMSearchDescription>
  <searchID>${randomSearchId()}</searchID>
  <trackIDList><trackID>${trackId}</trackID></trackIDList>
  <timeSpanList>
    <timeSpan>
      <startTime>${toIsapiTime(from)}</startTime>
      <endTime>${toIsapiTime(to)}</endTime>
    </timeSpan>
  </timeSpanList>
  <maxResults>10</maxResults>
  <searchResultPostion>0</searchResultPostion>
  <metadataList><metadataDescriptor>//metadata.ksh</metadataDescriptor></metadataList>
</CMSearchDescription>`

    const searchRes = await this.client.post(
      '/ISAPI/ContentMgmt/search', searchXml, 'application/xml',
    )

    const playbackUriMatch = searchRes.text.match(
      /<playbackURI>([^<]+)<\/playbackURI>/,
    )
    if (!playbackUriMatch) {
      throw new NvrAdapterError(this.vendor, 'not_found',
        `no recordings for ch${channel} between ${from.toISOString()} and ${to.toISOString()}`)
    }
    const playbackUri = playbackUriMatch[1]

    if (!playbackUri.startsWith('http')) {
      // F55.D: RTSP playback URL を ffmpeg pipeline で MP4 に変換
      const { createPlaybackPipeline } = await import('../../util/playback-pipeline')
      const pipeline = createPlaybackPipeline({
        rtspUrl:        playbackUri,
        transport:      'tcp',
        maxDurationSec: Math.ceil((to.getTime() - from.getTime()) / 1000) + 30,
      })
      void pipeline.finished.catch(() => { /* 終了は呼び出し側 stream で検知 */ })
      return pipeline.stream
    }

    const auth = 'Basic ' + Buffer.from(
      `${this.config.credentials.username}:${this.config.credentials.password}`,
    ).toString('base64')
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 60_000)
    try {
      const res = await fetch(playbackUri, {
        headers: { authorization: auth },
        signal:  ctl.signal,
      })
      if (!res.ok || !res.body) {
        throw new NvrAdapterError(this.vendor, 'transient',
          `Hikvision VOD download HTTP ${res.status}`)
      }
      const { Readable } = await import('stream')
      return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    } finally {
      clearTimeout(timer)
    }
  }

  async subscribeEvents(callback: NvrEventCallback): Promise<NvrEventSubscription> {
    // F55.E: /ISAPI/Event/notification/alertStream を long-poll で購読
    return subscribeHikvisionAlertStream({
      endpoint: this.config.endpoint,
      username: this.config.credentials.username,
      password: this.config.credentials.password,
    }, callback)
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

export async function createHikvisionAdapter(
  config: NvrAdapterConfig,
): Promise<NvrAdapter> {
  // FW 検出: /ISAPI/System/deviceInfo は XML 形式
  let firmware: FirmwareInfo
  try {
    const client = new IsapiClient({
      endpoint: config.endpoint,
      username: config.credentials.username,
      password: config.credentials.password,
      timeoutMs: config.timeoutMs ?? 5000,
    })
    const res = await client.get('/ISAPI/System/deviceInfo')
    const xml = res.text
    const model = (xml.match(/<model>([^<]+)<\/model>/) ?? [])[1] ?? 'unknown'
    const fw    = (xml.match(/<firmwareVersion>([^<]+)<\/firmwareVersion>/) ?? [])[1] ?? '0.0.0'
    const serial = (xml.match(/<serialNumber>([^<]+)<\/serialNumber>/) ?? [])[1]
    const { major, minor, patch } = parseHikvisionFw(fw)
    firmware = {
      vendor:       'hikvision',
      modelFamily:  inferHikvisionFamily(model),
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
      vendor:      'hikvision', modelFamily: 'unknown', modelNumber: 'unknown',
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
    supportsVod:              true,    // Phase 6 で実装、capability は宣言
    vodFormats:               ['mp4'],
    maxVodHours:              24,
    supportsEventPush:        true,
    supportsOnvifPullPoint:   true,
    supportsAiMetadata:       firmware.modelFamily === 'acusense',  // DS-7616NXI-K2/16P 等
    supportsMotionZone:       true,
    supportedCodecs:          ['h264', 'h265'],
    maxResolution:            '4K',
    maxChannels:              16,                // 拡張: option で 32/64 へ
    eventTypes:               ['motion', 'video_loss', 'tampering'],
    maxConcurrentSessions:    16,
    rateLimitMs:              200,
  }

  // AcuSense モデルで AI イベント追加
  if (firmware.modelFamily === 'acusense') {
    capabilities.eventTypes.push('ai_person', 'ai_vehicle')
  }

  return new HikvisionAdapter(config, firmware, capabilities)
}

function parseHikvisionFw(s: string): { major: number; minor: number; patch: number } {
  // 'V4.71.410 build 230718' のような形式
  const m = s.match(/V?(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!m) return { major: 0, minor: 0, patch: 0 }
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3] ?? '0', 10),
  }
}

// F53.A: ISAPI 時刻フォーマット (yyyy-MM-ddTHH:mm:ssZ)
function toIsapiTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function randomSearchId(): string {
  return 'cmsearch-' + Math.random().toString(36).slice(2, 12)
}

function inferHikvisionFamily(model: string): string {
  const m = model.toUpperCase()
  if (m.includes('NXI'))      return 'acusense'           // AI 内蔵
  if (m.startsWith('DS-76')   || m.startsWith('DS-86'))  return 'nvr_pro'
  if (m.startsWith('DS-72')   || m.startsWith('DS-77'))  return 'nvr_value'
  if (m.startsWith('DS-2CD')) return 'ip_camera'
  return 'unknown'
}
