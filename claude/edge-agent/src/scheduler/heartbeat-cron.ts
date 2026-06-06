/**
 * F48.C: ハートビート Cron スケジューラ
 *
 * 6時間 (21600 秒) 間隔で担当全店舗をハートビートする。Thundering herd 回避の
 * ため、各店舗のハートビート時刻は jitter で 0〜6時間にランダム分散する。
 *
 * 実装方針:
 *   - 起動時に「店舗ごとの初回タイムアウト」をランダム生成 (0..interval)
 *   - 以降は interval ごとに繰り返し
 *   - pool 増減時は onTenantAdded/Removed で schedule 追加/削除
 *
 * 並行制御:
 *   - 全店舗を一斉に叩かないように Semaphore で同時実行数を制限 (default 20)
 *   - 1 店舗の HB は最大 5 秒で打ち切り (heartbeat.ts 内タイムアウト)
 */
import { logger } from '../logger.js'
import { Semaphore } from '../util/semaphore.js'
import { HEARTBEAT_INTERVAL_CENTRAL_SEC } from '@intereco/shared'
import { pingStore } from './heartbeat'
import type { TenantPool } from '../modes/central/tenant-pool'

const DEFAULT_CONCURRENCY = 20

export class HeartbeatScheduler {
  private timers = new Map<string, NodeJS.Timeout>()
  private readonly sem: Semaphore
  private readonly intervalSec: number
  private running = false

  constructor(
    private readonly pool: TenantPool,
    opts: { intervalSec?: number; concurrency?: number } = {},
  ) {
    this.intervalSec = opts.intervalSec ?? HEARTBEAT_INTERVAL_CENTRAL_SEC
    this.sem = new Semaphore(opts.concurrency ?? DEFAULT_CONCURRENCY)
  }

  start(): void {
    if (this.running) return
    this.running = true
    // 現在の pool 全店舗を schedule
    for (const t of this.pool.list()) {
      this.scheduleStore(t.storeId)
    }
    logger.info({
      tenants:    this.pool.size,
      intervalSec: this.intervalSec,
      concurrency: 'sem 内部値',
    }, 'HeartbeatScheduler started')
  }

  stop(): void {
    this.running = false
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  /** Pool に新規追加された店舗を schedule (CentralRunner.onTenantAdded から呼ぶ) */
  addStore(storeId: string): void {
    if (!this.running) return
    if (this.timers.has(storeId)) return
    this.scheduleStore(storeId)
  }

  /** Pool から外れた店舗の schedule を解除 */
  removeStore(storeId: string): void {
    const t = this.timers.get(storeId)
    if (t) clearTimeout(t)
    this.timers.delete(storeId)
  }

  /** 店舗の有効 HB 間隔 (秒) を返す。F51.B: per-store override 対応 */
  private intervalForStore(storeId: string): number {
    const t = this.pool.get(storeId)
    return t?.heartbeatOverrideSec ?? this.intervalSec
  }

  private scheduleStore(storeId: string, initialDelayMs?: number): void {
    const sec = this.intervalForStore(storeId)
    // 起動時はランダム jitter、2 回目以降は interval を使う
    const delayMs = initialDelayMs ?? Math.floor(Math.random() * sec * 1000)
    const handle = setTimeout(() => {
      void this.executeHeartbeat(storeId)
    }, delayMs)
    this.timers.set(storeId, handle)
  }

  private async executeHeartbeat(storeId: string): Promise<void> {
    if (!this.running) return
    const tenant = this.pool.get(storeId)
    if (!tenant) {
      this.timers.delete(storeId)
      return
    }

    // Semaphore で並行数を制限
    await this.sem.acquire()
    try {
      const result = await pingStore(tenant)
      logger.debug({
        storeId,
        ok:        result.ok,
        latencyMs: result.latencyMs,
        error:     result.error,
        intervalSec: this.intervalForStore(storeId),
      }, 'heartbeat done')
    } catch (err) {
      logger.error({ storeId, err: (err as Error).message }, 'heartbeat error')
    } finally {
      this.sem.release()
    }

    // 次のインターバルを schedule (per-store override が変わってる可能性も拾う)
    this.scheduleStore(storeId, this.intervalForStore(storeId) * 1000)
  }

  /** 全店舗を即時 HB (デバッグ用) */
  async pingAllNow(): Promise<void> {
    const tenants = this.pool.list()
    await Promise.all(tenants.map(async (t) => {
      await this.sem.acquire()
      try { await pingStore(t) } finally { this.sem.release() }
    }))
  }
}
