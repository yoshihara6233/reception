/**
 * F53.D: Synology Surveillance Station Adapter
 *
 * DS423+ / DVA1622 等の Synology NAS (Surveillance Station) 対応。
 *
 * 機能:
 *   - testConnection: SYNO.API.Info で疎通確認
 *   - getChannelList: SYNO.SurveillanceStation.Camera List
 *   - getSnapshot:    SYNO.SurveillanceStation.Streaming GetSnapshot
 *   - getLiveRtspUri: SYNO.SurveillanceStation.Camera GetLiveViewPath
 *
 * 制約:
 *   - VOD は SYNO.SurveillanceStation.Recording の API でダウンロードできるが
 *     ライセンス制約が複雑 (Phase 7 で実装予定)
 *   - イベントは Action Rule のメール/HTTP 通知が主流 (Phase 7 で連携)
 */
import type {
  NvrAdapter, NvrAdapterConfig, NvrCapabilities, FirmwareInfo, NvrChannel,
} from '@intereco/shared'
import { CONSERVATIVE_CAPABILITIES, NvrAdapterError } from '@intereco/shared'
import { DsmClient } from './dsm-client'

interface SsCameraInfo {
  id:        number
  name:      string
  enabled:   boolean
  model:     string
}

export class SynologyAdapter implements NvrAdapter {
  readonly vendor = 'synology-surveillance' as const
  public readonly firmware:     FirmwareInfo
  public readonly capabilities: NvrCapabilities
  private readonly client: DsmClient
  private readonly config: NvrAdapterConfig
  private cameraCache: SsCameraInfo[] | null = null

  constructor(
    config:       NvrAdapterConfig,
    firmware:     FirmwareInfo,
    capabilities: NvrCapabilities,
    client?:      DsmClient,
  ) {
    this.config = config
    this.firmware = firmware
    this.capabilities = capabilities
    this.client = client ?? new DsmClient({
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
      // ログインだけで疎通確認
      await this.client.login()
      return true
    } catch {
      return false
    }
  }

  async getChannelList(): Promise<NvrChannel[]> {
    const cams = await this.fetchCameras()
    return cams.map((c, i) => ({
      index:   i + 1,
      name:    c.name,
      enabled: c.enabled,
    }))
  }

  async getSnapshot(channel: number): Promise<Buffer> {
    const cams = await this.fetchCameras()
    const cam = cams[channel - 1]
    if (!cam) {
      throw new NvrAdapterError(this.vendor, 'channel_unavailable',
        `channel ${channel} out of range (1..${cams.length})`)
    }
    const buf = await this.client.call<Buffer>(
      'SYNO.SurveillanceStation.Streaming',
      'GetSnapshot',
      { cameraId: cam.id },
      1,
    )
    if (!(buf instanceof Buffer) || buf.length < 2 || buf[0] !== 0xff || buf[1] !== 0xd8) {
      throw new NvrAdapterError(this.vendor, 'protocol_error',
        `Synology snapshot is not a JPEG`)
    }
    return buf
  }

  async getLiveRtspUri(channel: number, _stream?: 'main' | 'sub'): Promise<string> {
    void _stream
    const cams = await this.fetchCameras()
    const cam = cams[channel - 1]
    if (!cam) {
      throw new NvrAdapterError(this.vendor, 'channel_unavailable',
        `channel ${channel} out of range`)
    }
    // GetLiveViewPath は { id, mjpegHttpPath, rtspPath, ... } を返す
    const result = await this.client.call<Array<{ id: number; rtspPath: string }>>(
      'SYNO.SurveillanceStation.Camera',
      'GetLiveViewPath',
      { idList: cam.id },
      9,
    )
    const found = Array.isArray(result) ? result.find((r) => r.id === cam.id) : undefined
    if (!found?.rtspPath) {
      throw new NvrAdapterError(this.vendor, 'protocol_error',
        `Synology GetLiveViewPath returned no rtspPath for cam ${cam.id}`)
    }
    return found.rtspPath
  }

  async getVodMp4(channel: number, from: Date, to: Date): Promise<NodeJS.ReadableStream> {
    // F55.G: Synology Surveillance Station VOD MP4 実装
    // 2 段階:
    //   1. SYNO.SurveillanceStation.Recording List で対象録画 ID を検索
    //   2. SYNO.SurveillanceStation.Recording Download で MP4 を取得
    const cams = await this.fetchCameras()
    const cam = cams[channel - 1]
    if (!cam) {
      throw new NvrAdapterError(this.vendor, 'channel_unavailable',
        `channel ${channel} out of range`)
    }

    const hours = (to.getTime() - from.getTime()) / 3_600_000
    if (this.capabilities.maxVodHours > 0 && hours > this.capabilities.maxVodHours) {
      throw new NvrAdapterError(this.vendor, 'unsupported',
        `requested ${hours.toFixed(1)}h exceeds max ${this.capabilities.maxVodHours}h`)
    }

    // 1. 録画検索
    const fromSec = Math.floor(from.getTime() / 1000)
    const toSec   = Math.floor(to.getTime() / 1000)
    type ListResp = {
      total?:     number
      recordings: Array<{ id: number; cameraId: number; startTime: number; stopTime: number }>
    }
    const list = await this.client.call<ListResp>(
      'SYNO.SurveillanceStation.Recording', 'List',
      {
        cameraIds: cam.id,
        fromTime:  fromSec,
        toTime:    toSec,
        limit:     1,        // 最初の 1 件だけ取得
      },
      6,
    )
    const recordings = list.recordings ?? []
    if (recordings.length === 0) {
      throw new NvrAdapterError(this.vendor, 'not_found',
        `no recordings for cam ${cam.id} between ${from.toISOString()} and ${to.toISOString()}`)
    }
    const recId = recordings[0].id

    // 2. ダウンロード (binary stream)
    // SYNO.SurveillanceStation.Recording Download は HTTP 直接ダウンロード可
    // /webapi/entry.cgi?api=SYNO.SurveillanceStation.Recording&version=6&method=Download&recordingId=N&_sid=...
    // 内部で HTTP fetch して stream を返す必要があるため、DsmClient.call() を回避して
    // 直接 endpoint を組み立てる
    const sid = await this.getSid()
    const url = new URL(`${this.config.endpoint.replace(/\/+$/, '')}/webapi/entry.cgi`)
    url.searchParams.set('api',         'SYNO.SurveillanceStation.Recording')
    url.searchParams.set('version',     '6')
    url.searchParams.set('method',      'Download')
    url.searchParams.set('recordingId', String(recId))
    url.searchParams.set('mountId',     '0')
    url.searchParams.set('_sid',        sid)

    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 120_000)   // 2 分タイムアウト
    try {
      const res = await fetch(url.toString(), { signal: ctl.signal })
      if (!res.ok || !res.body) {
        throw new NvrAdapterError(this.vendor, 'transient',
          `Synology VOD download HTTP ${res.status}`)
      }
      const { Readable } = await import('stream')
      return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
    } finally {
      clearTimeout(timer)
    }
  }

  /** ログイン済 SID を取得 (Download API で URL パラメータとして必要) */
  private async getSid(): Promise<string> {
    // DsmClient 内部の sid を取り出すための間接的な方法:
    // login() を呼んで成功すれば SID が設定されているのでダミーコールで利用
    await (this.client as unknown as { login: () => Promise<string> }).login()
    // private な sid を取り出す (テストでは null チェック)
    const sid = (this.client as unknown as { sid: string | null }).sid
    if (!sid) {
      throw new NvrAdapterError(this.vendor, 'auth_failed', 'Synology SID not available')
    }
    return sid
  }

  async dispose(): Promise<void> {
    this.cameraCache = null
    await this.client.logout().catch(() => {})
  }

  // ─── helpers ───────────────────────────────────────────────────────────

  private async fetchCameras(): Promise<SsCameraInfo[]> {
    if (this.cameraCache) return this.cameraCache
    type ListResult = { cameras: Array<{ id: number; newName?: string; name?: string; enabled: boolean; model: string }> }
    const data = await this.client.call<ListResult>(
      'SYNO.SurveillanceStation.Camera', 'List', { basic: 'true' }, 9,
    )
    this.cameraCache = data.cameras.map((c) => ({
      id:      c.id,
      name:    c.newName ?? c.name ?? `Camera ${c.id}`,
      enabled: c.enabled,
      model:   c.model,
    }))
    return this.cameraCache
  }
}

// ─── ファクトリ ──────────────────────────────────────────────────────────────

export async function createSynologyAdapter(
  config: NvrAdapterConfig,
): Promise<NvrAdapter> {
  let firmware: FirmwareInfo
  try {
    const client = new DsmClient({
      endpoint: config.endpoint,
      username: config.credentials.username,
      password: config.credentials.password,
      timeoutMs: config.timeoutMs ?? 5000,
    })
    await client.login()
    // SYNO.API.Info は version で利用可能 API 一覧を返す → 接続成功で OK
    type InfoData = { 'SYNO.SurveillanceStation.Info'?: { maxVersion?: number } }
    await client.call<InfoData>('SYNO.API.Info', 'Query', {}, 1).catch(() => undefined)

    // DSM の system info で model を取得
    type SysInfo = { model?: string; version?: string }
    const sys = await client.call<SysInfo>(
      'SYNO.Core.System', 'info', {}, 1,
    ).catch(() => null)

    const model = sys?.model ?? 'unknown'
    const fw = sys?.version ?? '0.0'
    const { major, minor, patch } = parseSemver(fw)
    firmware = {
      vendor:       'synology',
      modelFamily:  inferSynologyFamily(model),
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
      vendor:      'synology', modelFamily: 'unknown', modelNumber: 'unknown',
      fwVersion: '0.0.0', fwMajor: 0, fwMinor: 0, fwPatch: 0,
      detectedAt: new Date(), source: 'header',
    }
  }

  const capabilities: NvrCapabilities = {
    ...CONSERVATIVE_CAPABILITIES,
    protocol:                 ['cgi'],
    authMethod:               'token',
    supportsSnapshot:         true,
    supportsLiveRtsp:         true,
    supportsLiveJpegPull:     true,
    // F55.G: VOD MP4 対応
    supportsVod:              true,
    vodFormats:               ['mp4'],
    maxVodHours:              24,
    supportsEventPush:        false,    // Action Rule 連携は Phase 7
    supportsAiMetadata:       firmware.modelFamily === 'dva_ai',  // DVA1622/3221
    supportsMotionZone:       true,
    supportedCodecs:          ['h264', 'h265'],
    maxResolution:            '4K',
    maxChannels:              32,
    maxConcurrentSessions:    4,
    rateLimitMs:              250,
    eventTypes:               ['motion', 'video_loss'],
  }

  return new SynologyAdapter(config, firmware, capabilities)
}

function parseSemver(s: string): { major: number; minor: number; patch: number } {
  const m = s.match(/(\d+)(?:\.(\d+))?(?:[\.\-](\d+))?/)
  if (!m) return { major: 0, minor: 0, patch: 0 }
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2] ?? '0', 10),
    patch: parseInt(m[3] ?? '0', 10),
  }
}

function inferSynologyFamily(model: string): string {
  const m = model.toUpperCase()
  if (m.startsWith('DVA'))   return 'dva_ai'       // Deep Learning NVR
  if (m.includes('PLUS'))    return 'ds_plus'      // + シリーズ (4-bay 以上)
  if (m.startsWith('DS'))    return 'ds_standard'
  if (m.startsWith('RS'))    return 'rs_rack'      // ラックマウント
  return 'unknown'
}
