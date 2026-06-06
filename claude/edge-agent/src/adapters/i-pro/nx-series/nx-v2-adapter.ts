/**
 * IProNxV2Adapter — WJ-NX 2020-2021 世代 (FW v2.x)
 *
 * v1.x からの差分:
 *   - ONVIF Profile T 対応 (AI metadata 受信可能)
 *   - max resolution 4K
 *   - max channels 32
 *   - max VOD hours 12 (v1 の 6h から拡大)
 *   - H.265 サポート
 *   - motion zone API 対応
 *   - tampering イベント追加
 *
 * 実装は v1 を継承し、capability の違いは matrix で吸収される。
 * VOD path も v1 と同じ (cgi-bin/playback)。
 */
import { IProNxV1Adapter } from './nx-v1-adapter'

export class IProNxV2Adapter extends IProNxV1Adapter {
  // 大半の API は v1 と互換。差分が出てきたら override
}
