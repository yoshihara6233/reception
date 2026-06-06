/**
 * F49.D: Circuit Breaker — NVR 単位の障害隔離
 *
 * 1 つの店舗 NVR が継続的に失敗していると、毎ポーリングで時間とリソースを浪費し
 * 他の店舗にまで影響する。Circuit Breaker パターンで以下を実現:
 *
 *   CLOSED    → 通常状態。実行可能。失敗カウントが閾値を超えると OPEN へ
 *   OPEN      → 障害状態。すべて即拒否 (時間/CPU 消費なし)。
 *               cooldown 経過後に HALF_OPEN へ
 *   HALF_OPEN → お試し状態。1 回だけ実行を許可。成功 → CLOSED、失敗 → OPEN
 *
 * 状態は in-memory (LRU)。中央集約モードのプロセス再起動でリセットされる。
 * Phase 3+ で DB 永続化を検討。
 */

export type CircuitState = 'closed' | 'open' | 'half_open'

export interface CircuitBreakerOptions {
  /** OPEN に遷移する連続失敗回数 (default 5) */
  failureThreshold:  number
  /** OPEN → HALF_OPEN へ遷移するまでの cooldown (ms, default 60_000) */
  cooldownMs:        number
  /** 連続成功でカウンタをリセットする回数 (default 2) */
  successThreshold:  number
}

const DEFAULTS: CircuitBreakerOptions = {
  failureThreshold: 5,
  cooldownMs:       60_000,
  successThreshold: 2,
}

interface BreakerEntry {
  state:              CircuitState
  failures:           number
  successes:          number       // HALF_OPEN 状態での連続成功カウント
  openedAt:           number       // OPEN へ移行した時刻 (ms)
  lastFailureMessage: string | null
}

export class CircuitBreaker {
  private breakers = new Map<string, BreakerEntry>()
  private readonly opts: CircuitBreakerOptions

  constructor(opts: Partial<CircuitBreakerOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts }
  }

  /**
   * 指定キー (店舗 ID 等) で操作を実行。
   * OPEN の場合は CircuitOpenError を投げ、 fn は呼ばない。
   *
   * @throws CircuitOpenError if breaker is OPEN
   * @throws 元の例外 if fn が失敗
   */
  async exec<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const state = this.getState(key)
    if (state === 'open') {
      throw new CircuitOpenError(key, this.timeUntilHalfOpen(key))
    }

    try {
      const result = await fn()
      this.recordSuccess(key)
      return result
    } catch (err) {
      this.recordFailure(key, err)
      throw err
    }
  }

  /**
   * 現在の状態を返す。OPEN かつ cooldown 経過していたら自動で HALF_OPEN に遷移。
   */
  getState(key: string): CircuitState {
    const e = this.breakers.get(key)
    if (!e) return 'closed'
    if (e.state === 'open' && Date.now() - e.openedAt >= this.opts.cooldownMs) {
      e.state = 'half_open'
      e.successes = 0
    }
    return e.state
  }

  /** key の状態をクリア (手動リセット) */
  reset(key: string): void {
    this.breakers.delete(key)
  }

  /** すべてリセット */
  resetAll(): void {
    this.breakers.clear()
  }

  /** 統計取得 (デバッグ用) */
  stats(): Array<{ key: string; state: CircuitState; failures: number; lastError: string | null }> {
    return [...this.breakers.entries()].map(([key, e]) => ({
      key,
      state:     e.state,
      failures:  e.failures,
      lastError: e.lastFailureMessage,
    }))
  }

  // ─── 内部 ───────────────────────────────────────────────────────────────

  private getOrCreate(key: string): BreakerEntry {
    let e = this.breakers.get(key)
    if (!e) {
      e = { state: 'closed', failures: 0, successes: 0, openedAt: 0, lastFailureMessage: null }
      this.breakers.set(key, e)
    }
    return e
  }

  private recordSuccess(key: string): void {
    const e = this.getOrCreate(key)
    if (e.state === 'half_open') {
      e.successes += 1
      if (e.successes >= this.opts.successThreshold) {
        e.state = 'closed'
        e.failures = 0
        e.lastFailureMessage = null
      }
    } else if (e.state === 'closed') {
      e.failures = 0
      e.lastFailureMessage = null
    }
  }

  private recordFailure(key: string, err: unknown): void {
    const e = this.getOrCreate(key)
    e.failures += 1
    e.lastFailureMessage = (err as Error)?.message ?? String(err)

    if (e.state === 'half_open') {
      // HALF_OPEN で失敗 → 再 OPEN
      e.state = 'open'
      e.openedAt = Date.now()
      e.successes = 0
    } else if (e.failures >= this.opts.failureThreshold) {
      e.state = 'open'
      e.openedAt = Date.now()
    }
  }

  private timeUntilHalfOpen(key: string): number {
    const e = this.breakers.get(key)
    if (!e || e.state !== 'open') return 0
    return Math.max(0, this.opts.cooldownMs - (Date.now() - e.openedAt))
  }
}

export class CircuitOpenError extends Error {
  constructor(public readonly key: string, public readonly retryAfterMs: number) {
    super(`circuit open for ${key}, retry in ${retryAfterMs}ms`)
    this.name = 'CircuitOpenError'
  }
}

// プロセス全体で共有のシングルトン (中央集約モード用)
export const globalBreaker = new CircuitBreaker()
