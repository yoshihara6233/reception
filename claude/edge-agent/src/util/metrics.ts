/**
 * F50.C: Prometheus 互換メトリクス (no external deps)
 *
 * 軽量な自前実装。`prom-client` 等のライブラリを足したくない理由:
 *   - edge-agent は dependencies を最小に保つ方針
 *   - 必要な機能 (Counter / Gauge / Histogram) は 100 行以下で書ける
 *
 * 出力形式: Prometheus text exposition (`# HELP`/`# TYPE`/`<name>{labels} value`)
 *
 * 使い方:
 *   import { registry, Counter, Gauge, Histogram } from './metrics'
 *   const cmd = new Counter('edge_commands_total', 'Total commands processed', ['command', 'result'])
 *   cmd.inc({ command: 'capture_snapshot', result: 'ok' })
 *   registry.serialize()  // テキスト出力
 */

// ── Label の正規化 ──────────────────────────────────────────────────────────

type Labels = Record<string, string | number>

function normalizeLabels(labels: Labels | undefined): string {
  if (!labels) return ''
  const parts: string[] = []
  for (const k of Object.keys(labels).sort()) {
    const v = String(labels[k])
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/"/g, '\\"')
    parts.push(`${k}="${v}"`)
  }
  return parts.length ? `{${parts.join(',')}}` : ''
}

// ── 基底クラス ───────────────────────────────────────────────────────────────

export abstract class Metric {
  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labelNames: string[] = [],
  ) {
    registry.register(this)
  }

  abstract type(): 'counter' | 'gauge' | 'histogram'
  abstract serialize(): string

  protected validateLabels(labels: Labels): void {
    for (const k of Object.keys(labels)) {
      if (!this.labelNames.includes(k)) {
        throw new Error(`Metric ${this.name}: unknown label ${k}`)
      }
    }
  }
}

// ── Counter ──────────────────────────────────────────────────────────────────

export class Counter extends Metric {
  private values = new Map<string, number>()

  type() { return 'counter' as const }

  inc(labels: Labels = {}, value = 1): void {
    this.validateLabels(labels)
    const key = normalizeLabels(labels)
    this.values.set(key, (this.values.get(key) ?? 0) + value)
  }

  serialize(): string {
    const lines: string[] = []
    lines.push(`# HELP ${this.name} ${this.help}`)
    lines.push(`# TYPE ${this.name} counter`)
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`)
    } else {
      for (const [labelStr, v] of this.values) {
        lines.push(`${this.name}${labelStr} ${v}`)
      }
    }
    return lines.join('\n')
  }
}

// ── Gauge ────────────────────────────────────────────────────────────────────

export class Gauge extends Metric {
  private values = new Map<string, number>()

  type() { return 'gauge' as const }

  set(value: number, labels: Labels = {}): void {
    this.validateLabels(labels)
    this.values.set(normalizeLabels(labels), value)
  }

  inc(labels: Labels = {}, value = 1): void {
    this.validateLabels(labels)
    const key = normalizeLabels(labels)
    this.values.set(key, (this.values.get(key) ?? 0) + value)
  }

  dec(labels: Labels = {}, value = 1): void { this.inc(labels, -value) }

  serialize(): string {
    const lines: string[] = []
    lines.push(`# HELP ${this.name} ${this.help}`)
    lines.push(`# TYPE ${this.name} gauge`)
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`)
    } else {
      for (const [labelStr, v] of this.values) {
        lines.push(`${this.name}${labelStr} ${v}`)
      }
    }
    return lines.join('\n')
  }
}

// ── Histogram ────────────────────────────────────────────────────────────────

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

export class Histogram extends Metric {
  private series = new Map<string, { sum: number; count: number; buckets: Map<number, number> }>()

  constructor(
    name: string, help: string, labelNames: string[] = [],
    private readonly buckets: number[] = DEFAULT_BUCKETS,
  ) {
    super(name, help, labelNames)
  }

  type() { return 'histogram' as const }

  observe(value: number, labels: Labels = {}): void {
    this.validateLabels(labels)
    const key = normalizeLabels(labels)
    let s = this.series.get(key)
    if (!s) {
      s = { sum: 0, count: 0, buckets: new Map() }
      for (const b of this.buckets) s.buckets.set(b, 0)
      s.buckets.set(Infinity, 0)
      this.series.set(key, s)
    }
    s.sum += value
    s.count += 1
    for (const b of this.buckets) {
      if (value <= b) s.buckets.set(b, (s.buckets.get(b) ?? 0) + 1)
    }
    s.buckets.set(Infinity, (s.buckets.get(Infinity) ?? 0) + 1)
  }

  /** ヘルパー: ms 単位の値を観測 (秒換算) */
  observeMs(ms: number, labels: Labels = {}): void {
    this.observe(ms / 1000, labels)
  }

  serialize(): string {
    const lines: string[] = []
    lines.push(`# HELP ${this.name} ${this.help}`)
    lines.push(`# TYPE ${this.name} histogram`)
    if (this.series.size === 0) {
      lines.push(`${this.name}_count 0`)
      lines.push(`${this.name}_sum 0`)
    } else {
      for (const [labelStr, s] of this.series) {
        const insertLabel = (le: string) => {
          if (!labelStr) return `{le="${le}"}`
          return labelStr.replace(/}$/, `,le="${le}"}`)
        }
        for (const b of this.buckets) {
          lines.push(`${this.name}_bucket${insertLabel(String(b))} ${s.buckets.get(b) ?? 0}`)
        }
        lines.push(`${this.name}_bucket${insertLabel('+Inf')} ${s.buckets.get(Infinity) ?? 0}`)
        lines.push(`${this.name}_sum${labelStr} ${s.sum}`)
        lines.push(`${this.name}_count${labelStr} ${s.count}`)
      }
    }
    return lines.join('\n')
  }
}

// ── Registry ─────────────────────────────────────────────────────────────────

class Registry {
  private metrics = new Map<string, Metric>()

  register(m: Metric): void {
    if (this.metrics.has(m.name)) {
      // 同名の再登録は許可 (テストでの再初期化対応)
      return
    }
    this.metrics.set(m.name, m)
  }

  /** Prometheus テキスト形式で全メトリクスを出力 */
  serialize(): string {
    const parts: string[] = []
    for (const m of this.metrics.values()) {
      parts.push(m.serialize())
    }
    return parts.join('\n\n') + '\n'
  }

  /** テスト用: 全消去 */
  clear(): void {
    this.metrics.clear()
  }

  get size(): number { return this.metrics.size }
}

export const registry = new Registry()

// ─── 標準メトリクス (edge-agent 内で使う) ───────────────────────────────────

export const m_commands_total = new Counter(
  'edge_commands_total',
  'Total commands processed by edge-agent',
  ['command', 'result', 'vendor'],
)

export const m_command_latency = new Histogram(
  'edge_command_duration_seconds',
  'Command execution latency in seconds',
  ['command', 'vendor'],
)

export const m_tenants_assigned = new Gauge(
  'edge_tenants_assigned',
  'Number of stores assigned to this node',
)

export const m_circuit_state = new Gauge(
  'edge_circuit_breaker_open_total',
  'Number of stores in circuit-breaker OPEN state',
)

export const m_heartbeat_total = new Counter(
  'edge_heartbeat_total',
  'Total heartbeat checks performed',
  ['result', 'vendor'],
)

export const m_adapter_cache_size = new Gauge(
  'edge_adapter_cache_size',
  'Current adapter instance cache size',
)
