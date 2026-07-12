/**
 * S4 レイテンシ集計の純ロジック（config/DB 非依存＝単体テスト可能）。
 * metric_events から読んだ ttff サンプルを transport 別に p50/p95 で要約する。
 * 実データ読取りは /infra/slo（サーバコンポーネント）が担う。
 */

/** transport タグ。sfu=LiveKit / hls=同一オリジンHLS / mjpeg等はその他に寄せる。 */
export type Transport = 'sfu' | 'hls' | 'other'

export interface TtffSample {
  value:     number       // ttff (ms)
  transport: Transport
}

export interface TransportStat {
  transport: Transport
  count:     number
  p50:       number | null   // ms
  p95:       number | null   // ms
  max:       number | null   // ms
}

/**
 * 線形補間なしの最近傍パーセンタイル（サンプル少数でも直感的）。
 * p は 0..1。空配列は null。
 */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[idx]
}

/** raw な meta.transport 値を既知の3種へ正規化。 */
export function normalizeTransport(raw: unknown): Transport {
  if (raw === 'sfu') return 'sfu'
  if (raw === 'hls') return 'hls'
  return 'other'
}

/** transport 別に count / p50 / p95 / max を算出。値なし transport は返さない。 */
export function summarizeTtff(samples: TtffSample[]): TransportStat[] {
  const groups = new Map<Transport, number[]>()
  for (const s of samples) {
    if (!Number.isFinite(s.value)) continue
    const arr = groups.get(s.transport) ?? []
    arr.push(s.value)
    groups.set(s.transport, arr)
  }
  const order: Transport[] = ['sfu', 'hls', 'other']
  const out: TransportStat[] = []
  for (const t of order) {
    const arr = groups.get(t)
    if (!arr || arr.length === 0) continue
    const sorted = [...arr].sort((a, b) => a - b)
    out.push({
      transport: t,
      count:     sorted.length,
      p50:       percentile(sorted, 0.5),
      p95:       percentile(sorted, 0.95),
      max:       sorted[sorted.length - 1],
    })
  }
  return out
}

/**
 * SFU egress の概算（LiveKit Cloud 課金予測用・実測ではない）。
 * 視聴 session-分 × 上限ビットレート（既定 2.5 Mbps）で見積る。
 * 1 視聴者分 = 2.5 Mbit/s × 60s = 150 Mbit = 18.75 MB/分。
 */
export function estimateEgressGiB(sessionMinutes: number, mbps = 2.5): number {
  const megabytesPerMin = (mbps * 60) / 8   // MB/分
  return (sessionMinutes * megabytesPerMin) / 1024
}
