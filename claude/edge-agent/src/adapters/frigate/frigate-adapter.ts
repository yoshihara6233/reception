/**
 * F46.21: Frigate Adapter
 *
 * 現行 Mini PC モード (per_store_minipc) で使われる Frigate (OSS-VMS) 用 adapter。
 * 既存 src/modes/bcp.ts と src/rtsp/url.ts のロジックを抽象化レイヤに移植する形。
 *
 * Frigate の場合:
 *   - snapshot:  http://<host>:5000/api/<camera>/latest.jpg
 *   - live RTSP: rtsp://<host>:8554/<camera>      (main / sub stream)
 *   - VOD MP4:   http://<host>:5000/api/<camera>/start/<unixFrom>/end/<unixTo>/clip.mp4
 *   - events:    HTTP MQTT 経由 (本 adapter では未実装、Phase 1 で対応)
 *
 * capability:
 *   - supportsSnapshot, supportsLiveRtsp, supportsVod, supportsTimelineSnapshot = true
 *   - supportsEventPush = false (MQTT は別経路で受ける)
 */
import type {
  NvrAdapter, NvrAdapterConfig, NvrCapabilities, FirmwareInfo, NvrChannel,
} from '../_base'
import { CONSERVATIVE_CAPABILITIES, NvrAdapterError } from '../_base'

const DEFAULT_API_PORT  = 5000
const DEFAULT_RTSP_PORT = 8554

interface FrigateOptions {
  /** camera マッピング: channel 番号 → Frigate camera 名 */
  cameraMap?:    Record<number, string>
  /** Frigate API ポート (デフォルト 5000) */
  apiPort?:      number
  /** Frigate RTSP ポート (go2rtc、デフォルト 8554) */
  rtspPort?:     number
  /** 全 channel 数 (省略時は cameraMap.size or 16) */
  channelCount?: number
}

export class FrigateAdapter implements NvrAdapter {
  readonly vendor = 'frigate' as const
  readonly capabilities: NvrCapabilities = {
    ...CONSERVATIVE_CAPABILITIES,
    protocol:                 ['rtsp_only'],
    supportsSnapshot:         true,
    supportsLiveRtsp:         true,
    supportsLiveJpegPull:     true,
    supportsVod:              true,
    vodFormats:               ['mp4'],
    maxVodHours:              6,
    supportsTimelineSnapshot: true,
    maxChannels:              16,
    maxResolution:            '4K',
    supportedCodecs:          ['h264', 'h265'],
    maxConcurrentSessions:    16,
    rateLimitMs:              50,
  }
  readonly firmware: FirmwareInfo = {
    vendor:      'frigate',
    modelFamily: 'docker',
    modelNumber: 'frigate-docker',
    fwVersion:   '0.13.x',
    fwMajor:     0,
    fwMinor:     13,
    fwPatch:     0,
    detectedAt:  new Date(),
    source:      'header',
  }

  private readonly config: NvrAdapterConfig
  private readonly options: FrigateOptions

  constructor(config: NvrAdapterConfig) {
    this.config = config
    this.options = (config.options ?? {}) as FrigateOptions
    // maxChannels を options から上書き
    if (this.options.channelCount) {
      this.capabilities.maxChannels = this.options.channelCount
    }
  }

  // ─── 必須メソッド ───────────────────────────────────────────────────────

  async testConnection(): Promise<boolean> {
    try {
      const url = `${this.apiBase}/api/config`
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      return res.ok
    } catch {
      return false
    }
  }

  async getChannelList(): Promise<NvrChannel[]> {
    // cameraMap が指定されていればそれを使う
    if (this.options.cameraMap) {
      return Object.entries(this.options.cameraMap).map(([ch, name]) => ({
        index:   parseInt(ch, 10),
        name,
        enabled: true,
      }))
    }
    // フォールバック: camera_NN 命名規約で channelCount 分生成
    const count = this.capabilities.maxChannels
    return Array.from({ length: count }, (_, i) => ({
      index:   i + 1,
      name:    `camera_${String(i + 1).padStart(2, '0')}`,
      enabled: true,
    }))
  }

  async getSnapshot(channel: number): Promise<Buffer> {
    const cameraName = this.cameraNameForChannel(channel)
    const url = `${this.apiBase}/api/${cameraName}/latest.jpg`
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) {
      throw new NvrAdapterError('frigate', 'transient',
        `frigate snapshot ${res.status}: ${url}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 2 || buf[0] !== 0xff || buf[1] !== 0xd8) {
      throw new NvrAdapterError('frigate', 'protocol_error',
        `frigate response is not a JPEG (got ${buf.length} bytes)`)
    }
    return buf
  }

  async getLiveRtspUri(channel: number, stream: 'main' | 'sub' = 'main'): Promise<string> {
    const cameraName = this.cameraNameForChannel(channel)
    const streamName = stream === 'sub' ? `${cameraName}_sub` : cameraName
    const auth = this.config.credentials.username
      ? `${encodeURIComponent(this.config.credentials.username)}:` +
        `${encodeURIComponent(this.config.credentials.password)}@`
      : ''
    return `rtsp://${auth}${this.endpointHost}:${this.rtspPort}/${streamName}`
  }

  async getVodMp4(channel: number, from: Date, to: Date): Promise<NodeJS.ReadableStream> {
    const cameraName = this.cameraNameForChannel(channel)
    const fromSec = Math.floor(from.getTime() / 1000)
    const toSec   = Math.floor(to.getTime() / 1000)
    const url = `${this.apiBase}/api/${cameraName}/start/${fromSec}/end/${toSec}/clip.mp4`
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok || !res.body) {
      throw new NvrAdapterError('frigate', 'transient', `frigate VOD ${res.status}`)
    }
    const { Readable } = await import('stream')
    return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  }

  async getTimelineSnapshots(
    channel:        number,
    referenceAt:    Date,
    offsetsMinutes: number[],
  ): Promise<Buffer[]> {
    // Frigate は時刻指定スナップショット API を持たないので、
    // 過去オフセット (T-5 等) は「現在の latest.jpg」で代替する。
    // 将来オフセット (T+0, T+5, …) は適切な時刻まで待ってから取得する。
    const results: Buffer[] = []
    for (const offset of offsetsMinutes) {
      const targetMs = referenceAt.getTime() + offset * 60_000
      if (offset >= 0) {
        const wait = targetMs - Date.now()
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
      }
      try {
        results.push(await this.getSnapshot(channel))
      } catch {
        results.push(Buffer.alloc(0))
      }
    }
    return results
  }

  async dispose(): Promise<void> { /* no-op */ }

  // ─── ヘルパー ───────────────────────────────────────────────────────────

  private get apiPort(): number {
    return this.options.apiPort ?? DEFAULT_API_PORT
  }
  private get rtspPort(): number {
    return this.options.rtspPort ?? DEFAULT_RTSP_PORT
  }

  private get apiBase(): string {
    const proto = this.config.endpoint.startsWith('https') ? 'https' : 'http'
    return `${proto}://${this.endpointHost}:${this.apiPort}`
  }

  private get endpointHost(): string {
    try {
      return new URL(this.config.endpoint).hostname
    } catch {
      return this.config.endpoint.replace(/^https?:\/\//, '').split(':')[0].split('/')[0]
    }
  }

  private cameraNameForChannel(channel: number): string {
    if (this.options.cameraMap?.[channel]) {
      return this.options.cameraMap[channel]
    }
    return `camera_${String(channel).padStart(2, '0')}`
  }
}

export async function createFrigateAdapter(config: NvrAdapterConfig): Promise<NvrAdapter> {
  return new FrigateAdapter(config)
}
