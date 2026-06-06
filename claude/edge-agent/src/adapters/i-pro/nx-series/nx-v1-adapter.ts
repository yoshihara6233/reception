/**
 * IProNxV1Adapter — WJ-NX 2018-2019 世代 (FW v1.x)
 *
 * 機能差分 (v2.x との比較):
 *   - ONVIF Profile S 限定 (Profile T 未対応)
 *   - AI metadata 未対応
 *   - max resolution 1080p
 *   - max channels 16
 *   - VOD MP4 export OK (path: /cgi-bin/playback?ch=N&start=Unix&end=Unix)
 *   - subscribeEvents: 基本 motion + video_loss のみ
 */
import type { NvrAdapterConfig, FirmwareInfo, NvrCapabilities, NvrVendor } from '../../_base'
import { IProBaseAdapter, type IProBaseAdapterDeps } from '../_common/i-pro-base-adapter'

export class IProNxV1Adapter extends IProBaseAdapter {
  constructor(
    config: NvrAdapterConfig,
    firmware: FirmwareInfo,
    capabilities: NvrCapabilities,
    deps?: IProBaseAdapterDeps,
    vendor: NvrVendor = 'i-pro-nx',
  ) {
    super(vendor, config, firmware, capabilities, deps)
  }

  async getVodMp4(channel: number, from: Date, to: Date): Promise<NodeJS.ReadableStream> {
    this.validateChannel(channel)
    const start = Math.floor(from.getTime() / 1000)
    const end   = Math.floor(to.getTime() / 1000)

    // v1.x の VOD path (実機で要検証 — F46.29)
    const url = `${this.config.endpoint.replace(/\/+$/, '')}` +
                `/cgi-bin/playback?ch=${channel}&start=${start}&end=${end}&fmt=mp4`

    const auth = 'Basic ' + Buffer.from(
      `${this.config.credentials.username}:${this.config.credentials.password}`,
    ).toString('base64')

    const res = await fetch(url, { headers: { authorization: auth } })
    if (!res.ok || !res.body) {
      throw new Error(`VOD fetch failed (status ${res.status})`)
    }
    // Web ReadableStream → Node.js Readable へ変換
    // (Node 18+ で web stream をそのまま読めるが、互換性のため type 上は ReadableStream を返す)
    const { Readable } = await import('stream')
    return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
  }
}
