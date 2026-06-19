/**
 * F52.A: ONVIF Generic Adapter
 *
 * Profile S/T 標準準拠の汎用 adapter。未知ベンダーや、ベンダー専用 adapter
 * を持たない機種の fallback として機能。
 *
 * 機能:
 *   - testConnection: GetDeviceInformation 成功で OK
 *   - getChannelList: GetProfiles → profile token を channel として扱う
 *   - getSnapshot:    GetSnapshotUri → そこから HTTP GET (Basic auth)
 *   - getLiveRtspUri: GetStreamUri
 *
 * 制約:
 *   - VOD MP4 (Profile G) は未実装
 *   - Event push (PullPoint) は Phase 6 で対応予定
 *   - capability は保守的に: snapshot + live + 基本情報のみ
 */
import type {
  NvrAdapter, NvrAdapterConfig, NvrCapabilities, FirmwareInfo,
  NvrChannel, NvrEventCallback, NvrEventSubscription,
} from '@intereco/shared'
import { CONSERVATIVE_CAPABILITIES, NvrAdapterError, AuthError } from '@intereco/shared'
import { OnvifSoapClient, parseDigestChallenge, buildHttpDigest } from './onvif-soap-client'
import { createPullPointSubscription } from './onvif-pull-point'

export class OnvifGenericAdapter implements NvrAdapter {
  readonly vendor = 'onvif-generic' as const
  public readonly firmware:     FirmwareInfo
  public readonly capabilities: NvrCapabilities
  private readonly client:    OnvifSoapClient
  private readonly config:    NvrAdapterConfig
  private profileCache:       Array<{ token: string; name: string }> | null = null

  constructor(
    config:       NvrAdapterConfig,
    firmware:     FirmwareInfo,
    capabilities: NvrCapabilities,
    client?:      OnvifSoapClient,
  ) {
    this.config = config
    this.firmware = firmware
    this.capabilities = capabilities
    this.client = client ?? new OnvifSoapClient({
      endpoint: config.endpoint,
      username: config.credentials.username,
      password: config.credentials.password,
      timeoutMs: config.timeoutMs,
    })
  }

  async testConnection(): Promise<boolean> {
    if (this.firmware.modelFamily === 'unknown') return false
    try {
      const info = await this.client.getDeviceInformation()
      return info.model.length > 0
    } catch {
      return false
    }
  }

  async getChannelList(): Promise<NvrChannel[]> {
    const profiles = await this.fetchProfiles()
    return profiles.map((p, i) => ({
      index:   i + 1,
      name:    p.name || p.token,
      enabled: true,
    }))
  }

  async getSnapshot(channel: number): Promise<Buffer> {
    this.validateChannel(channel)
    const profiles = await this.fetchProfiles()
    const profile = profiles[channel - 1]
    if (!profile) throw this.channelError(channel)

    const uri = await this.client.getSnapshotUri(profile.token)
    const buf = await this.fetchSnapshot(uri)
    if (buf.length < 2 || buf[0] !== 0xff || buf[1] !== 0xd8) {
      throw new NvrAdapterError(this.vendor, 'protocol_error',
        `ONVIF snapshot is not a JPEG (${buf.length} bytes)`)
    }
    return buf
  }

  /**
   * snapshot URI を HTTP GET。Basic で試し、401 + Digest チャレンジなら
   * Digest で再試行する (i-PRO カメラは Digest を要求することがある)。
   */
  private async fetchSnapshot(uri: string): Promise<Buffer> {
    const { username, password } = this.config.credentials
    const basic = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64')

    const doFetch = async (authHeader: string): Promise<Response> => {
      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), this.config.timeoutMs ?? 10_000)
      try {
        return await fetch(uri, { headers: { authorization: authHeader }, signal: ctl.signal })
      } finally {
        clearTimeout(timer)
      }
    }

    let res = await doFetch(basic)
    if (res.status === 401) {
      const challenge = res.headers.get('www-authenticate') ?? ''
      if (/digest/i.test(challenge)) {
        const digest = buildHttpDigest('GET', uri, username, password, parseDigestChallenge(challenge))
        res = await doFetch(digest)
      }
    }
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(this.vendor, `snapshot fetch ${res.status}`)
    }
    if (!res.ok) {
      throw new NvrAdapterError(this.vendor, 'transient', `snapshot HTTP ${res.status}`)
    }
    return Buffer.from(await res.arrayBuffer())
  }

  async getLiveRtspUri(channel: number, _stream?: 'main' | 'sub'): Promise<string> {
    void _stream
    this.validateChannel(channel)
    const profiles = await this.fetchProfiles()
    const profile = profiles[channel - 1]
    if (!profile) throw this.channelError(channel)
    return this.client.getStreamUri(profile.token, 'RTSP')
  }

  async subscribeEvents(callback: NvrEventCallback): Promise<NvrEventSubscription> {
    // F53.C: PullPoint で Event push を購読
    return createPullPointSubscription({
      endpoint: this.config.endpoint,
      username: this.config.credentials.username,
      password: this.config.credentials.password,
      timeoutMs: this.config.timeoutMs,
    }, callback)
  }

  async dispose(): Promise<void> {
    this.profileCache = null
  }

  // ─── helpers ───────────────────────────────────────────────────────────

  private async fetchProfiles(): Promise<Array<{ token: string; name: string }>> {
    if (this.profileCache) return this.profileCache
    this.profileCache = await this.client.getProfiles()
    return this.profileCache
  }

  private validateChannel(channel: number): void {
    if (channel < 1 || channel > this.capabilities.maxChannels) {
      throw this.channelError(channel)
    }
  }

  private channelError(channel: number): NvrAdapterError {
    return new NvrAdapterError(this.vendor, 'channel_unavailable',
      `channel ${channel} out of range (1..${this.capabilities.maxChannels})`)
  }
}

// ─── ファクトリ ──────────────────────────────────────────────────────────────

export async function createOnvifGenericAdapter(
  config: NvrAdapterConfig,
): Promise<NvrAdapter> {
  // FW 検出
  let firmware: FirmwareInfo
  try {
    const client = new OnvifSoapClient({
      endpoint: config.endpoint,
      username: config.credentials.username,
      password: config.credentials.password,
      timeoutMs: config.timeoutMs ?? 5000,
    })
    const info = await client.getDeviceInformation()
    const { major, minor, patch } = parseSemver(info.firmwareVersion)
    firmware = {
      vendor:       'onvif',
      modelFamily:  info.manufacturer.toLowerCase().replace(/\W+/g, '_') || 'onvif',
      modelNumber:  info.model,
      fwVersion:    info.firmwareVersion,
      fwMajor:      major,
      fwMinor:      minor,
      fwPatch:      patch,
      serial:       info.serialNumber,
      hwVersion:    info.hardwareId,
      detectedAt:   new Date(),
      source:       'onvif',
    }
  } catch {
    // FW 検出失敗時は unknown
    firmware = {
      vendor:      'onvif',
      modelFamily: 'unknown',
      modelNumber: 'unknown',
      fwVersion:   '0.0.0',
      fwMajor:     0,
      fwMinor:     0,
      fwPatch:     0,
      detectedAt:  new Date(),
      source:      'onvif',
    }
  }

  // capability: 保守的 (Profile S 想定)
  const capabilities: NvrCapabilities = {
    ...CONSERVATIVE_CAPABILITIES,
    protocol:               ['onvif'],
    supportsSnapshot:       true,
    supportsLiveRtsp:       true,
    supportsLiveJpegPull:   true,
    // F53.C: PullPoint Event 購読対応
    supportsEventPush:      true,
    supportsOnvifPullPoint: true,
    eventTypes:             ['motion', 'video_loss', 'tampering'],
    supportedCodecs:        ['h264', 'h265'],
    maxResolution:          '4K',
    maxChannels:            32,        // 大型 NVR を想定
    maxConcurrentSessions:  4,
    rateLimitMs:            500,
  }

  return new OnvifGenericAdapter(config, firmware, capabilities)
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
