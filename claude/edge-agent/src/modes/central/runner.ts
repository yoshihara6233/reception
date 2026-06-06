/**
 * F48.B: Central Runner — Tier 3 中央集約モードのエントリーポイント
 *
 * 起動シーケンス:
 *   1. LeaseManager.start() — central_nodes に自分を active 登録、リース更新開始
 *   2. TenantPool.start()   — 担当店舗を取得開始
 *   3. CommandDispatcher.start() — pending_commands ポーリング開始
 *   4. (Phase 1 後半) HeartbeatScheduler.start() — 6h ハートビート
 *
 * graceful shutdown:
 *   SIGTERM/SIGINT → LeaseManager.drain() → 30秒猶予 → stop all → process.exit(0)
 */
import { hostname } from 'os'
import { logger } from '../../logger.js'
import { LeaseManager } from './lease'
import { TenantPool } from './tenant-pool'
import { CommandDispatcher } from './command-dispatcher'
import { ShardManager } from './shard-manager'
import { adapterCache } from '../../adapters/_registry'
import { HeartbeatScheduler } from '../../scheduler'
import { startMetricsServer, stopMetricsServer } from '../../util/metrics-server'
import type { CentralRunnerConfig, TenantStore } from './types'

const DEFAULT_CONFIG: Omit<CentralRunnerConfig, 'nodeId' | 'hostname'> = {
  capacityStores: 5000,
  pollIntervalMs: 2_000,    // 2 秒ごとに pending_commands チェック
  heartbeatSec:   6 * 60 * 60,
  leaseRenewMs:   30_000,
  leaseTtlSec:    90,
}

export class CentralRunner {
  private lease: LeaseManager
  private pool: TenantPool
  private dispatcher: CommandDispatcher
  private heartbeat: HeartbeatScheduler
  private shard: ShardManager
  private shutdownRequested = false

  constructor(private readonly config: CentralRunnerConfig) {
    this.lease = new LeaseManager(
      config.nodeId, config.hostname, config.region,
      config.capacityStores, config.leaseTtlSec, config.leaseRenewMs,
    )
    this.shard = new ShardManager(config.nodeId, config.capacityStores)
    this.pool = new TenantPool(config.nodeId, {
      onAdd:    (s) => this.onTenantAdded(s),
      onRemove: (id) => this.onTenantRemoved(id),
    })
    this.dispatcher = new CommandDispatcher(
      config.nodeId, this.pool, config.pollIntervalMs,
    )
    this.heartbeat = new HeartbeatScheduler(this.pool, {
      intervalSec: config.heartbeatSec,
    })
  }

  async start(): Promise<void> {
    logger.info({ nodeId: this.config.nodeId, host: this.config.hostname },
      'CentralRunner starting')
    await this.lease.start()
    // F49.A: lease 取得後にシャードを取りに行く (他ノードから観測されるべき先後関係)
    const shardStats = await this.shard.start()
    logger.info(shardStats, 'ShardManager initial run')
    await this.pool.start()
    this.dispatcher.start()
    this.heartbeat.start()
    // F50.C: /metrics エンドポイント起動
    startMetricsServer({
      port: parseInt(process.env.METRICS_PORT ?? '9464', 10),
    })

    // graceful shutdown handlers
    for (const sig of ['SIGTERM', 'SIGINT'] as const) {
      process.on(sig, () => {
        if (this.shutdownRequested) return
        this.shutdownRequested = true
        logger.info({ sig }, 'CentralRunner shutdown requested')
        void this.stop().then(() => process.exit(0))
      })
    }

    logger.info({ tenants: this.pool.size }, 'CentralRunner ready')
  }

  async stop(): Promise<void> {
    logger.info({}, 'CentralRunner stopping')
    this.heartbeat.stop()
    this.dispatcher.stop()
    await this.lease.drain()
    await this.shard.stop()
    // F49.A: graceful shutdown 時は担当店舗を解放して他ノードへ譲る
    try {
      const released = await this.shard.releaseAll()
      logger.info({ released }, 'released stores during shutdown')
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'releaseAll failed (continuing)')
    }
    await new Promise((r) => setTimeout(r, 5000))   // 短い drain 期間
    await this.pool.stop()
    await this.lease.stop()
    await adapterCache.disposeAll()
    await stopMetricsServer()
    logger.info({}, 'CentralRunner stopped')
  }

  private onTenantAdded(store: TenantStore): void {
    logger.info({ storeId: store.storeId, vendor: store.nvrVendor },
      'tenant added to pool')
    this.heartbeat.addStore(store.storeId)
  }

  private onTenantRemoved(storeId: string): void {
    logger.info({ storeId }, 'tenant removed from pool')
    this.heartbeat.removeStore(storeId)
    void adapterCache.dispose(storeId)
  }
}

/**
 * 標準起動: 環境変数から config を組み立てて runner を起動
 *
 * 必須 env:
 *   CENTRAL_NODE_ID       — central_nodes.id (uuid)
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * 任意 env:
 *   CENTRAL_REGION        — 'ap-northeast-1' 等
 *   CENTRAL_CAPACITY      — 担当上限 (default 5000)
 *   CENTRAL_POLL_INTERVAL_MS — pending_commands poll 間隔 (default 2000)
 *   CENTRAL_HEARTBEAT_SEC — 6時間 (21600) デフォルト
 */
export async function startCentralRunnerFromEnv(): Promise<CentralRunner> {
  const nodeId = process.env.CENTRAL_NODE_ID
  if (!nodeId) {
    throw new Error('CENTRAL_NODE_ID env var is required for central mode')
  }
  const cfg: CentralRunnerConfig = {
    ...DEFAULT_CONFIG,
    nodeId,
    hostname:       process.env.HOSTNAME ?? hostname(),
    region:         process.env.CENTRAL_REGION,
    capacityStores: parseInt(process.env.CENTRAL_CAPACITY ?? String(DEFAULT_CONFIG.capacityStores), 10),
    pollIntervalMs: parseInt(process.env.CENTRAL_POLL_INTERVAL_MS ?? String(DEFAULT_CONFIG.pollIntervalMs), 10),
    heartbeatSec:   parseInt(process.env.CENTRAL_HEARTBEAT_SEC ?? String(DEFAULT_CONFIG.heartbeatSec), 10),
  }
  const runner = new CentralRunner(cfg)
  await runner.start()
  return runner
}
