/**
 * F55.A: Axis VAPIX Adapter
 *
 * Axis 全ライン (Q3xxx / P3xxx / M3xxx 等) 対応。
 *
 * 機能:
 *   - testConnection: /axis-cgi/param.cgi?action=list&group=root.Brand
 *   - getSnapshot:    /axis-cgi/jpg/image.cgi?camera=N
 *   - getLiveRtspUri: rtsp://user:pass@host:554/axis-media/media.amp?camera=N
 *
 * 特性:
 *   - 単体 IP カメラと M30/M70 シリーズ (PoE スイッチ + IP カメラ統合) 両対応
 *   - VAPIX は ONVIF Profile S/T も並行サポート → onvif-generic 経由でも動く
 *   - イベントは VAPIX の Event/StreamConfig 経由 (Phase 8+ で実装予定)
 */
import type {
  NvrAdapter, NvrAdapterConfig, NvrCapabilities, FirmwareInfo, NvrChannel,
} from '@intereco/shared'
import { CONSERVATIVE_CAPABILITIES, NvrAdapterError } from '@intereco/shared'
import { VapixClient } from './vapix-client'

export class AxisAdapter implements NvrAdapter {
  readonly vendor = 'axis-vapix' as const
  public readonly firmware:     FirmwareInfo
  public readonly capabilities: NvrCapabilities
  private readonly client: VapixClient
  private readonly config: NvrAdapterConfig

  constructor(
    config:       NvrAdapterConfig,
    firmware:     FirmwareInfo,
    capabilities: NvrCapabilities,
    client?:      VapixClient,
  ) {
    this.config = config
    this.firmware = firmware
    this.capabilities = capabilities
    this.client = client ?? new VapixClient({
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
      const res = await this.client.get('/axis-cgi/param.cgi', {
        action: 'list', group: 'root.Brand',
      })
      return res.status === 200 && res.text.includes('Brand')
    } catch {
      return false
    }
  }

  async getChannelList(): Promise<NvrChannel[]> {
    // 多くの Axis 製品は 1ch (単体 IP カメラ)
    // M30/M70 シリーズは複数 (4/8/16ch)
    const list: NvrChannel[] = []
    for (let i = 1; i <= this.capabilities.maxChannels; i++) {
      list.push({
        index:   i,
        name:    `Channel ${i}`,
        enabled: true,
      })
    }
    return list
  }

  async getSnapshot(channel: number): Promise<Buffer> {
    this.validateChannel(channel)
    const res = await this.client.get('/axis-cgi/jpg/image.cgi', {
      camera: channel,
    })
    if (res.body.length < 2 || res.body[0] !== 0xff || res.body[1] !== 0xd8) {
      throw new NvrAdapterError(this.vendor, 'protocol_error',
        `Axis snapshot is not a JPEG (${res.body.length} bytes)`)
    }
    return res.body
  }

  async getLiveRtspUri(channel: number, stream: 'main' | 'sub' = 'main'): Promise<string> {
    this.validateChannel(channel)
    // Axis RTSP: rtsp://user:pass@host:554/axis-media/media.amp?camera=N&videocodec=h264
    //   サブストリームは &resolution=... で別解像度を指定
    const { host } = this.parseEndpoint()
    const rtspPort = (this.config.options.rtsp_port as number | undefined) ?? 554
    const auth = `${encodeURIComponent(this.config.credentials.username)}:` +
                 `${encodeURIComponent(this.config.credentials.password)}`
    const params = new URLSearchParams({ camera: String(channel), videocodec: 'h264' })
    if (stream === 'sub') {
      params.set('resolution', '640x360')
    }
    return `rtsp://${auth}@${host}:${rtspPort}/axis-media/media.amp?${params.toString()}`
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

export async function createAxisAdapter(
  config: NvrAdapterConfig,
): Promise<NvrAdapter> {
  let firmware: FirmwareInfo
  try {
    const client = new VapixClient({
      endpoint: config.endpoint,
      username: config.credentials.username,
      password: config.credentials.password,
      timeoutMs: config.timeoutMs ?? 5000,
    })
    // root.Brand.Brand / root.Brand.ProdNbr / root.Properties.Firmware.Version
    const res = await client.get('/axis-cgi/param.cgi', {
      action: 'list', group: 'root.Brand,root.Properties.Firmware',
    })
    const model =
      (res.text.match(/root\.Brand\.ProdNbr=(.+)/) ?? [])[1]?.trim() ?? 'unknown'
    const fw =
      (res.text.match(/root\.Properties\.Firmware\.Version=(.+)/) ?? [])[1]?.trim() ?? '0.0.0'
    const { major, minor, patch } = parseSemver(fw)
    firmware = {
      vendor:       'axis',
      modelFamily:  inferAxisFamily(model),
      modelNumber:  model,
      fwVersion:    fw,
      fwMajor:      major,
      fwMinor:      minor,
      fwPatch:      patch,
      detectedAt:   new Date(),
      source:       'cgi',
    }
  } catch {
    firmware = {
      vendor:      'axis', modelFamily: 'unknown', modelNumber: 'unknown',
      fwVersion: '0.0.0', fwMajor: 0, fwMinor: 0, fwPatch: 0,
      detectedAt: new Date(), source: 'header',
    }
  }

  const isMultiChannelDevice =
    firmware.modelFamily === 'm30_series' || firmware.modelFamily === 'm70_series'

  const capabilities: NvrCapabilities = {
    ...CONSERVATIVE_CAPABILITIES,
    protocol:                 ['cgi', 'onvif'],
    authMethod:               'digest',
    supportsSnapshot:         true,
    supportsLiveRtsp:         true,
    supportsLiveJpegPull:     true,
    supportsVod:              false,    // Edge Storage は Phase 8+ で対応
    supportsEventPush:        false,    // VAPIX Event/Stream は Phase 8+ で対応
    supportsOnvifPullPoint:   true,     // ONVIF 経由なら今でも可
    supportsAiMetadata:       true,     // AXIS Object Analytics 等
    supportsMotionZone:       true,
    supportsPtz:              true,
    supportedCodecs:          ['h264', 'h265'],
    maxResolution:            '4K',
    maxChannels:              isMultiChannelDevice ? 16 : 1,
    eventTypes:               ['motion', 'video_loss', 'tampering'],
    maxConcurrentSessions:    8,
    rateLimitMs:              200,
  }

  return new AxisAdapter(config, firmware, capabilities)
}

function parseSemver(s: string): { major: number; minor: number; patch: number } {
  const m = s.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/)
  if (!m) return { major: 0, minor: 0, patch: 0 }
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2] ?? '0', 10),
    patch: parseInt(m[3] ?? '0', 10),
  }
}

function inferAxisFamily(model: string): string {
  const m = model.toUpperCase()
  if (m.startsWith('Q3'))  return 'q3_series'        // フラッグシップ PTZ/Fixed Dome
  if (m.startsWith('P3'))  return 'p3_series'        // パフォーマンス Fixed Dome
  if (m.startsWith('M3'))  return 'm3_series'        // コンパクト IP カメラ
  if (m.startsWith('M70')) return 'm70_series'       // PoE + IP カメラ統合
  if (m.startsWith('M30')) return 'm30_series'       // マルチセンサー
  if (m.startsWith('F'))   return 'f_modular'        // モジュラー
  return 'unknown'
}
