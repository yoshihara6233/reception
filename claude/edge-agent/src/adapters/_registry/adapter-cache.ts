/**
 * F46.12: Adapter Cache
 *
 * 中央集約モードで店舗ごとに adapter インスタンスをキャッシュ。
 * FW Ver が変わったら自動的に再生成。
 *
 * LRU で最大 12,000 インスタンス保持 (10k 店舗 + バッファ)。
 */
import type { NvrAdapter, NvrAdapterConfig, NvrVendor } from '../_base'
import { getAdapter } from './registry'

const MAX_CACHE_SIZE = 12_000

interface CacheEntry {
  adapter:     NvrAdapter
  fwVersion:   string         // FW 変化検知用
  lastUsedAt:  number         // LRU 用
}

class AdapterCache {
  private readonly cache = new Map<string, CacheEntry>()

  /**
   * 店舗に対応する adapter を取得 (キャッシュヒット or 新規生成)。
   * @param storeId キャッシュキー
   * @param config  adapter 設定
   * @param expectedFwVersion 期待する FW Ver (NULL なら検証スキップ)
   */
  async getOrCreate(
    storeId: string,
    config: NvrAdapterConfig,
    expectedFwVersion?: string | null,
  ): Promise<NvrAdapter> {
    const hit = this.cache.get(storeId)

    // FW Ver 変化検知: cached より新しい FW が DB に記録されていたら破棄
    if (hit && expectedFwVersion && hit.fwVersion !== expectedFwVersion) {
      await this.dispose(storeId)
    } else if (hit) {
      hit.lastUsedAt = Date.now()
      return hit.adapter
    }

    // 新規生成
    const adapter = await getAdapter(config.vendor, config)

    // LRU evict
    if (this.cache.size >= MAX_CACHE_SIZE) {
      this.evictOldest()
    }

    this.cache.set(storeId, {
      adapter,
      fwVersion:  adapter.firmware.fwVersion,
      lastUsedAt: Date.now(),
    })
    return adapter
  }

  /** 明示的に破棄 (店舗削除時など) */
  async dispose(storeId: string): Promise<void> {
    const entry = this.cache.get(storeId)
    if (entry) {
      try {
        await entry.adapter.dispose()
      } catch (err) {
        // dispose 失敗は警告のみ (リソースリークの可能性は logger 経由で見える)
        console.warn(`adapter.dispose failed for ${storeId}:`, err)
      }
      this.cache.delete(storeId)
    }
  }

  /** 全破棄 (シャットダウン時) */
  async disposeAll(): Promise<void> {
    const ids = [...this.cache.keys()]
    await Promise.all(ids.map((id) => this.dispose(id)))
  }

  /** LRU: 最も古い 1 件を破棄 */
  private evictOldest(): void {
    let oldestId: string | null = null
    let oldestTime = Infinity
    for (const [id, entry] of this.cache) {
      if (entry.lastUsedAt < oldestTime) {
        oldestTime = entry.lastUsedAt
        oldestId = id
      }
    }
    if (oldestId) {
      // dispose は async だが evict は同期的に削除する
      // (リソース解放は best-effort で非同期に実行)
      const entry = this.cache.get(oldestId)
      this.cache.delete(oldestId)
      void entry?.adapter.dispose().catch(() => { /* ignored */ })
    }
  }

  /** デバッグ: キャッシュサイズ */
  get size(): number {
    return this.cache.size
  }
}

// シングルトン (edge-agent プロセス全体で 1 インスタンス)
export const adapterCache = new AdapterCache()
