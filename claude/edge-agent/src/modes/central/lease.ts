/**
 * F48.B: Lease Manager — HA リース管理
 *
 * central_nodes.lease_held_until に「自分が稼働中」マーカーを書き込み、
 * 定期的に延長する。他ノードが lease_held_until < now() を検出したら
 * シャード再分散の対象になる。
 *
 * Phase 1: シンプルな自己ハートビート + lease 延長のみ。
 * Phase 2: 失効ノードの担当店舗を健全ノードへ自動移管 (re-shard) を実装予定。
 */
import { type SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from '../../supabase.js'

let _supa: SupabaseClient | null = null
export function _setSupa(client: SupabaseClient): void { _supa = client }
function getSupa(): SupabaseClient {
  return _supa ?? getSupabase()   // テスト override 優先・通常は中央クライアント(鍵同期)
}

export class LeaseManager {
  private renewTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly nodeId:        string,
    private readonly hostname:      string,
    private readonly region:        string | undefined,
    private readonly capacityStores: number,
    private readonly ttlSec:        number,
    private readonly renewMs:       number,
  ) {}

  /** ノードを active 状態で登録し、リースを継続更新する */
  async start(): Promise<void> {
    await this.upsertNode('active')
    this.renewTimer = setInterval(() => {
      void this.renew().catch((err) => {
        console.error('LeaseManager renew failed', err)
      })
    }, this.renewMs)
  }

  async stop(): Promise<void> {
    if (this.renewTimer) {
      clearInterval(this.renewTimer)
      this.renewTimer = null
    }
    // 明示シャットダウン時は status=down に
    await this.upsertNode('down').catch(() => {})
  }

  /** 排出モードへ移行 (新規割当を受け取らない) */
  async drain(): Promise<void> {
    await this.upsertNode('draining')
  }

  private async renew(): Promise<void> {
    const expiresAt = new Date(Date.now() + this.ttlSec * 1000).toISOString()
    const { error } = await getSupa()
      .from('central_nodes')
      .update({
        lease_held_until: expiresAt,
        last_heartbeat:   new Date().toISOString(),
      })
      .eq('id', this.nodeId)
    if (error) throw new Error(error.message)
  }

  private async upsertNode(status: 'active' | 'draining' | 'down'): Promise<void> {
    const expiresAt = status === 'active'
      ? new Date(Date.now() + this.ttlSec * 1000).toISOString()
      : null
    const { error } = await getSupa()
      .from('central_nodes')
      .upsert({
        id:               this.nodeId,
        hostname:         this.hostname,
        region:           this.region ?? null,
        capacity_stores:  this.capacityStores,
        status,
        lease_held_until: expiresAt,
        last_heartbeat:   new Date().toISOString(),
      }, { onConflict: 'id' })
    if (error) throw new Error(`LeaseManager upsert: ${error.message}`)
  }
}
