/**
 * F52.C: i-PRO WJ-GXE500 Adapter
 *
 * WJ-GXE500 = アナログカメラ 4ch を IP ネットワークに変換するエンコーダ。
 * - 純粋な「変換器」なので録画機能なし、イベント push なし
 * - 古いアナログカメラ (D1/960H) を IP NVR に接続する用途
 *
 * 機能:
 *   - testConnection: /cgi-bin/getsysteminfo (NX/NU と同じ)
 *   - getSnapshot:    /cgi-bin/snapshot.cgi?ch=N
 *   - getLiveRtspUri: rtsp://<host>/MediaInput/h264/stream_X (chは host 単位)
 *
 * 非対応:
 *   - VOD MP4 (録画機能なし)
 *   - subscribeEvents (event push なし)
 *   - getTimelineSnapshots (過去時刻スナップショット不可)
 *   - motion zone
 *   - PTZ
 *
 * IProBaseAdapter を継承して capability で機能を縮退する。
 */
import type { NvrAdapter, NvrAdapterConfig, NvrCapabilities, FirmwareInfo } from '@intereco/shared'
import { NvrAdapterError, UnsupportedOperationError } from '@intereco/shared'
import { detectIProFirmware, deriveCapabilities } from '../_common'
import { IProBaseAdapter, type IProBaseAdapterDeps } from '../_common/i-pro-base-adapter'

export class IProGxe500Adapter extends IProBaseAdapter {
  constructor(
    config: NvrAdapterConfig,
    firmware: FirmwareInfo,
    capabilities: NvrCapabilities,
    deps?: IProBaseAdapterDeps,
  ) {
    super('i-pro-gxe500', config, firmware, capabilities, deps)
  }

  // VOD はサポートしない
  async getVodMp4(_ch: number, _from: Date, _to: Date): Promise<NodeJS.ReadableStream> {
    throw new UnsupportedOperationError(this.vendor, 'WJ-GXE500 does not support recording / VOD export')
  }

  // WJ-GXE500 の RTSP URL は WJ-NX 系と多少パスが異なるケースあり (機種ごとに 1〜4)
  // capability.maxChannels = 4 で固定
  async getLiveRtspUri(channel: number, stream: 'main' | 'sub' = 'main'): Promise<string> {
    if (channel < 1 || channel > 4) {
      throw new NvrAdapterError(this.vendor, 'channel_unavailable',
        `WJ-GXE500 channel ${channel} out of range (1..4)`)
    }
    const { host } = this.parseEndpointHostPort()
    const rtspPort = (this.config.options.rtsp_port as number | undefined) ?? 554
    const auth = `${encodeURIComponent(this.config.credentials.username)}:` +
                 `${encodeURIComponent(this.config.credentials.password)}`
    // WJ-GXE500: rtsp://user:pass@host:554/MediaInput/h264/ch<N>_<main|sub>
    // (NX/NU と同じパス、host あたり 4ch)
    const profile = stream === 'sub' ? 'sub' : 'main'
    const chStr = String(channel).padStart(2, '0')
    return `rtsp://${auth}@${host}:${rtspPort}/MediaInput/h264/ch${chStr}_${profile}`
  }
}

// ─── ファクトリ ──────────────────────────────────────────────────────────────

export async function createIProGxe500Adapter(
  config: NvrAdapterConfig,
): Promise<NvrAdapter> {
  const firmware = await detectIProFirmware({
    endpoint:    config.endpoint,
    credentials: config.credentials,
    timeoutMs:   config.timeoutMs,
  })

  // GXE500 として強制 (検出 family が unknown でも fallback で GXE 扱い)
  const fwForCaps: FirmwareInfo = {
    ...firmware,
    modelFamily: firmware.modelFamily === 'gxe' ? 'gxe' : 'gxe',
  }
  const capabilities = deriveCapabilities(fwForCaps)

  return new IProGxe500Adapter(config, firmware, capabilities)
}
