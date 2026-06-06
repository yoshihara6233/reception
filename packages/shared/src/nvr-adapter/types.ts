/**
 * NvrAdapter 共通型定義 (packages/shared 版・正本)
 *
 * monitor (Next.js) と edge-agent (Bun) の両方から参照される。
 * 旧:
 *   - claude/monitor/src/lib/nvr-adapter/types.ts   (shim へ縮退)
 *   - claude/edge-agent/src/adapters/_base/nvr-adapter.ts (shim へ縮退)
 *
 * 設計詳細:
 *   - docs/tier3/nvr-adapter-design.md
 *   - docs/tier3/firmware-capability-matrix.md
 */

// ─── ベンダー識別子 ──────────────────────────────────────────────────────────

export type NvrVendor =
  | 'frigate'                  // 各店 Mini PC モード (現行)
  | 'i-pro-nx'                 // WJ-NX200/300/400/510
  | 'i-pro-nu'                 // WJ-NU101K/201K/301K
  | 'i-pro-gxe500'             // WJ-GXE500 アナログ→IP 変換
  // Phase 5 追加 NVR ベンダー
  | 'hikvision'
  | 'hanwha-wisenet'
  | 'synology-surveillance'
  | 'axis-vapix'
  | 'onvif-generic'
  // Phase 7 追加
  | 'dahua'                    // Dahua DH-NVR / IPC

export type DeploymentMode = 'per_store_minipc' | 'central_aggregator'

// ─── FW 情報 ─────────────────────────────────────────────────────────────────

export type FirmwareDetectionSource = 'cgi' | 'onvif' | 'header'

export interface FirmwareInfo {
  vendor:        string
  modelFamily:   string
  modelNumber:   string
  fwVersion:     string
  fwMajor:       number
  fwMinor:       number
  fwPatch:       number
  hwVersion?:    string
  serial?:       string
  detectedAt:    Date
  source:        FirmwareDetectionSource
}

// ─── Capability ──────────────────────────────────────────────────────────────

export type NvrProtocol = 'cgi' | 'onvif' | 'sdk' | 'rtsp_only'
export type NvrAuthMethod = 'digest' | 'basic' | 'token'
export type VodFormat = 'mp4' | 'avi' | 'i-pro-proprietary' | 'mkv'
export type NvrEventType =
  | 'motion' | 'video_loss' | 'tampering' | 'ai_person' | 'ai_vehicle' | 'audio_anomaly'
export type NvrResolution = 'D1' | '960H' | '720p' | '1080p' | '4K' | '8K'
export type NvrCodec = 'h264' | 'h265' | 'mjpeg' | 'h266'

export interface NvrCapabilities {
  protocol:                 NvrProtocol[]
  authMethod:               NvrAuthMethod
  supportsSnapshot:         boolean
  supportsLiveRtsp:         boolean
  supportsLiveJpegPull:     boolean
  supportsVod:              boolean
  vodFormats:               VodFormat[]
  maxVodHours:              number
  supportsEventPush:        boolean
  supportsOnvifPullPoint:   boolean
  eventTypes:               NvrEventType[]
  supportsAiMetadata:       boolean
  supportsActiveGuard:      boolean
  supportsAiOnIpro:         boolean
  maxResolution:            NvrResolution
  maxChannels:              number
  supportedCodecs:          NvrCodec[]
  supportsTimelineSnapshot: boolean
  supportsMotionZone:       boolean
  supportsPtz:              boolean
  maxConcurrentSessions:    number
  rateLimitMs:              number
}

// ─── Channel / Event ─────────────────────────────────────────────────────────

export interface NvrChannel {
  index:        number
  name:         string
  enabled:      boolean
  resolution?:  NvrResolution
  codec?:       NvrCodec
  fps?:         number
  hasAudio?:    boolean
  hasPtz?:      boolean
}

export interface NvrEvent {
  type:        NvrEventType
  channel:     number
  occurredAt:  Date
  receivedAt:  Date
  payload?:    Record<string, unknown>
}

export type NvrEventCallback = (evt: NvrEvent) => void | Promise<void>

export interface NvrEventSubscription {
  unsubscribe: () => Promise<void>
}

// ─── アダプタ設定 ────────────────────────────────────────────────────────────

export interface NvrAdapterConfig {
  storeId:        string
  vendor:         NvrVendor
  endpoint:       string
  credentials: {
    username:     string
    password:     string
  }
  options:        Record<string, unknown>
  timeoutMs?:     number
  retryCount?:    number
}

// ─── アダプタ・インターフェイス ──────────────────────────────────────────────

export interface NvrAdapter {
  readonly vendor:        NvrVendor
  readonly capabilities:  NvrCapabilities
  readonly firmware:      FirmwareInfo

  testConnection(): Promise<boolean>
  getChannelList(): Promise<NvrChannel[]>
  getSnapshot(channel: number): Promise<Buffer>
  getLiveRtspUri(channel: number, stream?: 'main' | 'sub'): Promise<string>

  getVodMp4?(channel: number, from: Date, to: Date): Promise<NodeJS.ReadableStream>
  subscribeEvents?(callback: NvrEventCallback): Promise<NvrEventSubscription>
  getTimelineSnapshots?(
    channel: number,
    referenceAt: Date,
    offsetsMinutes: number[],
  ): Promise<Buffer[]>
  getMotionZones?(channel: number): Promise<unknown[]>

  dispose(): Promise<void>
}

// ─── ファクトリ ──────────────────────────────────────────────────────────────

export type AdapterFactory = (config: NvrAdapterConfig) => Promise<NvrAdapter>
export type AdapterRegistry = Partial<Record<NvrVendor, AdapterFactory>>
