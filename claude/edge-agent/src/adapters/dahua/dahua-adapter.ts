/**
 * F55.B: Dahua DH-NVR / IPC Adapter
 *
 * Dahua 全ラインの NVR (DH-NVRxxxx) と IPC (DH-IPCxxxx) に対応。
 *
 * 機能:
 *   - testConnection: /cgi-bin/magicBox.cgi?action=getDeviceType
 *   - getSnapshot:    /cgi-bin/snapshot.cgi?channel=N
 *   - getLiveRtspUri: rtsp://...:554/cam/realmonitor?channel=N&subtype=0|1
 *   - getVodMp4:      mediaFileFind → loadfile (Phase 8+ で本実装)
 *
 * 特性:
 *   - 多くのモデルは ONVIF Profile S/T 並行サポート
 *   - AcuPick AI 検知あり (上位機種)
 */
import type {
  NvrAdapter, NvrAdapterConfig, NvrCapabilities, FirmwareInfo, NvrChannel,
} from '@intereco/shared'
import { CONSERVATIVE_CAPABILITIES, NvrAdapterError } from '@intereco/shared'
import { DahuaCgiClient } from './dahua-cgi-client'

export class DahuaAdapter implements NvrAdapter {
  readonly vendor = 'dahua' as const
  public readonly firmware:     FirmwareInfo
  public readonly capabilities: NvrCapabilities
  private readonly client: DahuaCgiClient
  private readonly config: NvrAdapterConfig

  constructor(
    config:       NvrAdapterConfig,
    firmware:     FirmwareInfo,
    capabilities: NvrCapabilities,
    client?:      DahuaCgiClient,
  ) {
    this.config = config
    this.firmware = firmware
    this.capabilities = capabilities
    this.client = client ?? new DahuaCgiClient({
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
      const res = await this.client.get('/cgi-bin/magicBox.cgi', {
        action: 'getDeviceType',
      })
      // 応答例: type=DH-NVR4216-4KS2
      return res.status === 200 && /type\s*=/i.test(res.text)
    } catch {
      return false
    }
  }

  async getChannelList(): Promise<NvrChannel[]> {
    const list: NvrChannel[] = []
    for (let i = 1; i <= this.capabilities.maxChannels; i++) {
      list.push({ index: i, name: `Channel ${i}`, enabled: true })
    }
    return list
  }

  async getSnapshot(channel: number): Promise<Buffer> {
    this.validateChannel(channel)
    const res = await this.client.get('/cgi-bin/snapshot.cgi', {
      channel,
    })
    if (res.body.length < 2 || res.body[0] !== 0xff || res.body[1] !== 0xd8) {
      throw new NvrAdapterError(this.vendor, 'protocol_error',
        `Dahua snapshot is not a JPEG (${res.body.length} bytes)`)
    }
    return res.body
  }

  async getLiveRtspUri(channel: number, stream: 'main' | 'sub' = 'main'): Promise<string> {
    this.validateChannel(channel)
    // Dahua RTSP: rtsp://user:pass@host:554/cam/realmonitor?channel=N&subtype=0|1
    //   subtype 0 = main, 1 = sub
    const { host } = this.parseEndpoint()
    const rtspPort = (this.config.options.rtsp_port as number | undefined) ?? 554
    const auth = `${encodeURIComponent(this.config.credentials.username)}:` +
                 `${encodeURIComponent(this.config.credentials.password)}`
    const subtype = stream === 'sub' ? 1 : 0
    return `rtsp://${auth}@${host}:${rtspPort}/cam/realmonitor?channel=${channel}&subtype=${subtype}`
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

export async function createDahuaAdapter(
  config: NvrAdapterConfig,
): Promise<NvrAdapter> {
  let firmware: FirmwareInfo
  try {
    const client = new DahuaCgiClient({
      endpoint: config.endpoint,
      username: config.credentials.username,
      password: config.credentials.password,
      timeoutMs: config.timeoutMs ?? 5000,
    })
    // Model (例: type=DH-NVR4216-4KS2)
    const modelRes = await client.get('/cgi-bin/magicBox.cgi', { action: 'getDeviceType' })
    const model = (modelRes.text.match(/type\s*=\s*(.+)/i) ?? [])[1]?.trim() ?? 'unknown'

    // FW Version (例: version=V4.001.0000000.1.R)
    const fwRes = await client.get('/cgi-bin/magicBox.cgi', { action: 'getSoftwareVersion' })
    const fw = (fwRes.text.match(/version\s*=\s*V?(.+)/i) ?? [])[1]?.trim() ?? '0.0.0'

    const { major, minor, patch } = parseDahuaFw(fw)
    firmware = {
      vendor:       'dahua',
      modelFamily:  inferDahuaFamily(model),
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
      vendor:      'dahua', modelFamily: 'unknown', modelNumber: 'unknown',
      fwVersion: '0.0.0', fwMajor: 0, fwMinor: 0, fwPatch: 0,
      detectedAt: new Date(), source: 'header',
    }
  }

  const isNvr = firmware.modelFamily.startsWith('nvr')

  const capabilities: NvrCapabilities = {
    ...CONSERVATIVE_CAPABILITIES,
    protocol:                 ['cgi', 'onvif'],
    authMethod:               'digest',
    supportsSnapshot:         true,
    supportsLiveRtsp:         true,
    supportsLiveJpegPull:     true,
    supportsVod:              isNvr,    // NVR は録画あり、IPC は通常なし
    vodFormats:               ['mp4'],
    maxVodHours:              24,
    supportsEventPush:        true,
    supportsOnvifPullPoint:   true,
    supportsAiMetadata:       firmware.modelFamily === 'nvr_acupick' ||
                              firmware.modelFamily === 'ipc_wizmind',
    supportsMotionZone:       true,
    supportsPtz:              true,
    supportedCodecs:          ['h264', 'h265'],
    maxResolution:            '4K',
    maxChannels:              isNvr ? 16 : 1,
    eventTypes:               ['motion', 'video_loss', 'tampering'],
    maxConcurrentSessions:    16,
    rateLimitMs:              200,
  }

  if (capabilities.supportsAiMetadata) {
    capabilities.eventTypes.push('ai_person', 'ai_vehicle')
  }

  return new DahuaAdapter(config, firmware, capabilities)
}

function parseDahuaFw(s: string): { major: number; minor: number; patch: number } {
  // 'V4.001.0000000.1.R' のような形式
  const cleaned = s.replace(/^V/, '')
  const m = cleaned.match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!m) return { major: 0, minor: 0, patch: 0 }
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3] ?? '0', 10),
  }
}

function inferDahuaFamily(model: string): string {
  const m = model.toUpperCase()
  if (m.includes('NVR') && (m.includes('-AI') || m.includes('-4KS3')))  return 'nvr_acupick'
  if (m.includes('NVR'))         return 'nvr_pro'
  if (m.includes('XVR'))         return 'xvr_hybrid'      // アナログ+IP ハイブリッド
  if (m.includes('IPC-HF')   || m.includes('WIZMIND'))   return 'ipc_wizmind'   // AI IPC
  if (m.includes('IPC'))         return 'ipc_standard'
  return 'unknown'
}
