/**
 * C3 計測テレメトリの記録ヘルパ（metric_events への best-effort 書込み）。
 * 失敗しても本処理を止めない（計測は副次的）。書込みは service client
 * (RLSバイパス) で行うので cron / サーバ側のどこからでも呼べる。
 */
import { createSupabaseService } from '@/lib/supabase/server'

export interface MetricInput {
  kind:      string                 // 'edge_uptime' | 'ttff_ms' | 'latency_ms' | ...
  storeId?:  string | null
  edgeId?:   string | null
  cameraId?: string | null
  userId?:   string | null
  value?:    number | null
  meta?:     Record<string, unknown> | null
}

export async function recordMetric(m: MetricInput): Promise<void> {
  try {
    await createSupabaseService().from('metric_events').insert({
      kind:      m.kind,
      store_id:  m.storeId ?? null,
      edge_id:   m.edgeId ?? null,
      camera_id: m.cameraId ?? null,
      user_id:   m.userId ?? null,
      value:     m.value ?? null,
      meta:      m.meta ?? null,
    })
  } catch (e) {
    console.error('[metrics] record failed:', e)
  }
}

/** クライアント計測 ingest で受け付ける kind の許可リスト（乱用防止）。 */
export const CLIENT_METRIC_KINDS = ['ttff_ms', 'latency_ms', 'vod_ready_ms', 'live_error'] as const
export type ClientMetricKind = (typeof CLIENT_METRIC_KINDS)[number]
