/**
 * IProNxV3PlusAdapter — WJ-NX 2022+ 世代 (FW v3.x, v4.x)
 *
 * v2.x からの差分:
 *   - iPRO Active Guard 連携 API 追加
 *   - getTimelineSnapshots ネイティブ対応 (BCP 用 8 枚一括取得)
 *   - max VOD hours 24
 *   - max concurrent sessions 16
 *   - rate limit 200ms (より高速)
 *   - eventTypes に ai_person / ai_vehicle が追加
 *   - v4.x では AI on iPRO 連携も追加 (rateLimitMs=100)
 */
import type { NvrEventCallback, NvrEventSubscription } from '../../_base'
import { IProNxV2Adapter } from './nx-v2-adapter'

export class IProNxV3PlusAdapter extends IProNxV2Adapter {

  /**
   * BCP タイムラインスナップショット (8 枚一括)。
   * v3+ では NVR 側で過去フレームバッファを持つので、T-5 のような過去オフセットも
   * native で取得可能。古い世代では「呼んだ時点の最新フレーム」しか取れない。
   *
   * @param channel       チャンネル番号 (1-based)
   * @param referenceAt   T+0 の基準時刻
   * @param offsetsMinutes 取得オフセット (例: [-5, 0, 5, 10, 15, 20, 25, 30])
   */
  async getTimelineSnapshots(
    channel:        number,
    referenceAt:    Date,
    offsetsMinutes: number[],
  ): Promise<Buffer[]> {
    this.validateChannel(channel)
    const results: Buffer[] = []
    for (const offset of offsetsMinutes) {
      // 簡易実装: 各オフセットを 1 枚ずつ取得
      // 本番では並列化 (Semaphore 制御) — F46.29 で実機検証時に最適化
      const at = new Date(referenceAt.getTime() + offset * 60_000)
      const ts = Math.floor(at.getTime() / 1000)
      const res = await this.cgi.get({
        path:   '/cgi-bin/snapshot.cgi',
        params: { ch: channel, time: ts },  // v3+ の time パラメータ対応
        binary: true,
      })
      if (res.type === 'binary' && res.body[0] === 0xff && res.body[1] === 0xd8) {
        results.push(res.body)
      } else {
        // 取得失敗時は空 Buffer (上位でハンドリング)
        results.push(Buffer.alloc(0))
      }
    }
    return results
  }

  /**
   * ONVIF Pull Point イベント購読 (motion / video_loss / AI events)。
   *
   * v3+ では AI イベント (ai_person / ai_vehicle) を含む全イベントを ONVIF 経由で
   * 受信できる。本格的な ONVIF クライアントは Phase 1 で node-onvif を使う予定で、
   * 現実装はポーリングベースのスタブ。
   */
  async subscribeEvents(callback: NvrEventCallback): Promise<NvrEventSubscription> {
    // Phase 1 で node-onvif の CreatePullPointSubscription に置換予定
    // 現実装: 定期的に /cgi-bin/getEvents をポーリングする簡易版
    const intervalMs = Math.max(1000, this.capabilities.rateLimitMs * 4)
    const handle = setInterval(() => {
      void this.cgi.get({ path: '/cgi-bin/getEvents' }).then((res) => {
        if (res.type !== 'text') return
        // key=value 形式のイベントを 1 行 1 件と仮定してパース
        for (const line of res.body.split(/[\r\n]+/)) {
          const m = line.match(/^(\w+)=(\d+),(.+)$/)
          if (!m) continue
          const type = m[1] as 'motion' | 'video_loss' | 'tampering' | 'ai_person' | 'ai_vehicle'
          const channel = parseInt(m[2], 10)
          void callback({
            type, channel,
            occurredAt: new Date(m[3]),
            receivedAt: new Date(),
            payload:    { raw: line },
          })
        }
      }).catch(() => { /* ポーリング失敗は無視 */ })
    }, intervalMs)
    return {
      unsubscribe: async () => { clearInterval(handle) },
    }
  }
}
