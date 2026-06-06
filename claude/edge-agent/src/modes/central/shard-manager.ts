/**
 * F49.A: ShardManager — 店舗の自動 claim + 失効ノードのテイクオーバー
 *
 * 役割:
 *   1. **初期 claim**: 起動時に central_node_id が NULL の店舗を
 *      自分のキャパシティまで割り当てる
 *   2. **rebalance**: 定期的に未割当店舗を取り込む
 *   3. **takeover**: 他ノードの lease_held_until < now() を検出したら
 *      その担当店舗をスナッチ
 *
 * 衝突回避:
 *   - claim は単一 UPDATE で「central_node_id IS NULL AND ...」を条件にして
 *     最初に勝ったノードだけがコミット成功 (Postgres MVCC)
 *   - capacity を超える claim は同 SQL の制限で防ぐ
 *
 * Active-Active 設計:
 *   - 各ノードが独立して同じロジックを動かす
 *   - リース更新は LeaseManager (lease.ts) が別経路で実施
 *   - lease 失効 = ノードダウンとみなし、他ノードが店舗を引き取る
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { logger } from '../../logger.js'

let _supa: SupabaseClient | null = null
export function _setSupa(client: SupabaseClient): void { _supa = client }
function getSupa(): SupabaseClient {
  if (!_supa) {
    _supa = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
  }
  return _supa
}

const REBALANCE_INTERVAL_MS = 60_000          // 1 分間隔で rebalance
const TAKEOVER_CHECK_INTERVAL_MS = 30_000     // 30 秒間隔で他ノード失効チェック

export interface ShardStats {
  claimed:  number   // 今回のサイクルで新規 claim した店舗数
  released: number   // 今回のサイクルで手放した店舗数 (capacity 超過時)
  takeover: number   // 他ノードから引き取った店舗数
  current:  number   // 現在の担当店舗数
  capacity: number
}

export class ShardManager {
  private rebalanceTimer: NodeJS.Timeout | null = null
  private takeoverTimer:  NodeJS.Timeout | null = null

  constructor(
    private readonly nodeId:   string,
    private readonly capacity: number,
  ) {}

  /** 起動時の初期 claim + 定期 rebalance/takeover 開始 */
  async start(): Promise<ShardStats> {
    const stats = await this.runOnce()
    this.rebalanceTimer = setInterval(() => {
      void this.runOnce().catch((err) =>
        logger.error({ err: (err as Error).message }, 'ShardManager rebalance failed')
      )
    }, REBALANCE_INTERVAL_MS)
    this.takeoverTimer = setInterval(() => {
      void this.takeoverFailedNodes().catch((err) =>
        logger.error({ err: (err as Error).message }, 'ShardManager takeover failed')
      )
    }, TAKEOVER_CHECK_INTERVAL_MS)
    return stats
  }

  async stop(): Promise<void> {
    if (this.rebalanceTimer) clearInterval(this.rebalanceTimer)
    if (this.takeoverTimer)  clearInterval(this.takeoverTimer)
    this.rebalanceTimer = null
    this.takeoverTimer = null
  }

  /** 担当店舗を全解放 (drain 後の cleanup 用) */
  async releaseAll(): Promise<number> {
    const { count, error } = await getSupa()
      .from('stores')
      .update({ central_node_id: null }, { count: 'exact' })
      .eq('central_node_id', this.nodeId)
    if (error) throw new Error(error.message)
    return count ?? 0
  }

  /** 単発 rebalance: 未割当店舗を取り込む */
  async runOnce(): Promise<ShardStats> {
    const current = await this.countMyStores()
    const room = Math.max(0, this.capacity - current)
    let claimed = 0
    let released = 0

    if (room > 0) {
      claimed = await this.claimUnassigned(room)
    } else if (current > this.capacity) {
      // capacity を超えている場合、超過分を解放 (新規ノード加入時の自動分散)
      released = await this.releaseExcess(current - this.capacity)
    }

    return {
      claimed, released, takeover: 0,
      current:  current + claimed - released,
      capacity: this.capacity,
    }
  }

  /** 未割当の店舗を claim (deployment_mode='central_aggregator' のみ) */
  private async claimUnassigned(limit: number): Promise<number> {
    // 最大 limit 件、central_node_id IS NULL の店舗を取得
    const { data: candidates, error: selErr } = await getSupa()
      .from('stores')
      .select('id')
      .eq('deployment_mode', 'central_aggregator')
      .is('central_node_id', null)
      .limit(limit)
    if (selErr || !candidates || candidates.length === 0) return 0

    const ids = (candidates as Array<{ id: string }>).map((r) => r.id)
    // 衝突回避: 「まだ central_node_id IS NULL」のものだけ UPDATE
    // (他ノードが先に取った場合は何もしない)
    const { count, error: updErr } = await getSupa()
      .from('stores')
      .update({ central_node_id: this.nodeId }, { count: 'exact' })
      .in('id', ids)
      .is('central_node_id', null)
    if (updErr) throw new Error(updErr.message)
    const claimed = count ?? 0
    if (claimed > 0) {
      logger.info({ nodeId: this.nodeId, claimed }, 'ShardManager claimed stores')
    }
    return claimed
  }

  /** capacity 超過分を解放 (新規ノード加入時の自動分散) */
  private async releaseExcess(excess: number): Promise<number> {
    const { data: mine, error: selErr } = await getSupa()
      .from('stores')
      .select('id')
      .eq('central_node_id', this.nodeId)
      .order('id')      // 安定したソート (LRU 的でないが OK)
      .limit(excess)
    if (selErr || !mine) return 0
    const ids = (mine as Array<{ id: string }>).map((r) => r.id)
    const { count, error: updErr } = await getSupa()
      .from('stores')
      .update({ central_node_id: null }, { count: 'exact' })
      .in('id', ids)
    if (updErr) throw new Error(updErr.message)
    return count ?? 0
  }

  /** 他ノードの失効リースを検出 → 担当店舗を引き取る */
  private async takeoverFailedNodes(): Promise<number> {
    // 失効ノード: lease_held_until < now() OR status='down'
    const { data: failed, error: nErr } = await getSupa()
      .from('central_nodes')
      .select('id, hostname, lease_held_until, status')
      .neq('id', this.nodeId)
      .or(`status.eq.down,lease_held_until.lt.${new Date().toISOString()}`)
    if (nErr || !failed || failed.length === 0) return 0

    const failedIds = (failed as Array<{ id: string; hostname: string }>).map((r) => r.id)
    logger.warn({ failedNodes: failedIds.length },
      'ShardManager detected failed nodes, taking over')

    // 引き取り可能な余裕を計算
    const current = await this.countMyStores()
    const room = Math.max(0, this.capacity - current)
    if (room === 0) {
      logger.info({ nodeId: this.nodeId }, 'capacity full, cannot take over now')
      return 0
    }

    // 失効ノードの担当店舗を最大 room 件取って自分に付け替え
    const { data: orphans, error: selErr } = await getSupa()
      .from('stores')
      .select('id')
      .in('central_node_id', failedIds)
      .limit(room)
    if (selErr || !orphans) return 0
    const orphanIds = (orphans as Array<{ id: string }>).map((r) => r.id)

    // 衝突回避: 「まだ failed ノードの central_node_id」のものだけ UPDATE
    const { count, error: updErr } = await getSupa()
      .from('stores')
      .update({ central_node_id: this.nodeId }, { count: 'exact' })
      .in('id', orphanIds)
      .in('central_node_id', failedIds)
    if (updErr) throw new Error(updErr.message)

    const taken = count ?? 0
    if (taken > 0) {
      logger.info({ taken, from: failedIds }, 'ShardManager took over orphan stores')
    }
    return taken
  }

  private async countMyStores(): Promise<number> {
    const { count, error } = await getSupa()
      .from('stores')
      .select('id', { count: 'exact', head: true })
      .eq('central_node_id', this.nodeId)
    if (error) throw new Error(error.message)
    return count ?? 0
  }
}
