/**
 * F48.C: ハートビート実行ロジック
 *
 * 担当店舗の NVR に対して adapter.testConnection() を実行し、結果を
 * monitor_heartbeats テーブルに記録する。失敗時はインシデント連携 (将来)。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { adapterCache } from '../adapters/_registry'
import { resolveCredentialsCached } from '../adapters/_base/credential-resolver'
import { HEARTBEAT_INTERVAL_CENTRAL_SEC } from '@intereco/shared'
import { m_heartbeat_total } from '../util/metrics'
import type { TenantStore } from '../modes/central/types'

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

export interface HeartbeatResult {
  storeId:   string
  ok:        boolean
  latencyMs: number
  error?:    string
}

/**
 * 1 店舗分のハートビート実行。
 * adapter.testConnection() を 5 秒タイムアウトで叩き、結果を DB に書き込む。
 */
export async function pingStore(tenant: TenantStore): Promise<HeartbeatResult> {
  const t0 = Date.now()
  let ok = false
  let error: string | undefined

  if (!tenant.nvrVendor || !tenant.nvrEndpoint) {
    error = 'NVR not configured'
  } else {
    try {
      const creds = tenant.nvrCredentialsRef
        ? await resolveCredentialsCached(tenant.nvrCredentialsRef)
        : { username: 'admin', password: '' }
      const adapter = await adapterCache.getOrCreate(
        tenant.storeId,
        {
          storeId:     tenant.storeId,
          vendor:      tenant.nvrVendor,
          endpoint:    tenant.nvrEndpoint,
          credentials: creds,
          options:     tenant.nvrOptions,
        },
        tenant.nvrFwVersion,
      )
      ok = await Promise.race([
        adapter.testConnection(),
        new Promise<boolean>((_, rej) =>
          setTimeout(() => rej(new Error('heartbeat timeout 5s')), 5000),
        ),
      ])
    } catch (err) {
      error = (err as Error).message
      ok = false
    }
  }

  const latencyMs = Date.now() - t0
  await recordHeartbeat(tenant.storeId, ok, latencyMs, error)
  // F50.C: メトリクス記録
  m_heartbeat_total.inc({
    result: ok ? 'ok' : 'fail',
    vendor: tenant.nvrVendor ?? 'unknown',
  })
  return { storeId: tenant.storeId, ok, latencyMs, error }
}

async function recordHeartbeat(
  storeId:   string,
  ok:        boolean,
  latencyMs: number,
  errorMsg?: string,
): Promise<void> {
  const { error } = await getSupa()
    .from('monitor_heartbeats')
    .insert({
      store_id:                 storeId,
      heartbeat_interval_sec:   HEARTBEAT_INTERVAL_CENTRAL_SEC,
      reachable:                ok,
      latency_ms:               latencyMs,
      error:                    errorMsg ?? null,
      recorded_at:              new Date().toISOString(),
    })
  if (error) {
    console.warn('heartbeat insert failed', error.message)
  }
}
