/**
 * F48.B: TenantPool — このノードが担当する店舗の管理
 *
 * 役割:
 *   - stores.central_node_id = self.nodeId の店舗を定期的に取得
 *   - 追加/削除を差分検知して上位に通知
 *   - 簡易キャッシュ + 30 秒間隔の refresh
 *
 * Phase 1 後半でシャード再分散 (consistent hash) と組み合わせる予定。
 * 現状はスタブ実装で「担当店舗一覧の取得」のみ。
 */
import { type SupabaseClient } from '@supabase/supabase-js'
import { getSupabase } from '../../supabase.js'
import { m_tenants_assigned } from '../../util/metrics'
import type { TenantStore } from './types'

const REFRESH_INTERVAL_MS = 30_000

let _supa: SupabaseClient | null = null
export function _setSupa(client: SupabaseClient): void { _supa = client }
function getSupa(): SupabaseClient {
  return _supa ?? getSupabase()   // テスト override 優先・通常は中央クライアント(鍵同期)
}

export class TenantPool {
  private tenants: Map<string, TenantStore> = new Map()
  private refreshTimer: NodeJS.Timeout | null = null
  private readonly onAdd:    (s: TenantStore) => void
  private readonly onRemove: (storeId: string) => void

  constructor(
    private readonly nodeId:   string,
    handlers: {
      onAdd?:    (s: TenantStore) => void
      onRemove?: (storeId: string) => void
    } = {},
  ) {
    this.onAdd = handlers.onAdd ?? (() => {})
    this.onRemove = handlers.onRemove ?? (() => {})
  }

  async start(): Promise<void> {
    await this.refresh()
    this.refreshTimer = setInterval(() => {
      void this.refresh().catch((err) => {
        console.error('TenantPool refresh failed', err)
      })
    }, REFRESH_INTERVAL_MS)
  }

  async stop(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  /** Pull current assignment from DB and emit add/remove diffs */
  async refresh(): Promise<void> {
    const { data, error } = await getSupa()
      .from('stores')
      .select(
        'id, name, deployment_mode, nvr_vendor, nvr_endpoint, ' +
        'nvr_credentials_ref, nvr_options, nvr_fw_version, ' +
        'heartbeat_override_sec',
      )
      .eq('central_node_id', this.nodeId)
      .eq('deployment_mode', 'central_aggregator')
    if (error) throw new Error(`TenantPool refresh: ${error.message}`)

    const next = new Map<string, TenantStore>()
    type Row = {
      id: string; name: string; deployment_mode: string
      nvr_vendor: string | null; nvr_endpoint: string | null
      nvr_credentials_ref: string | null
      nvr_options: Record<string, unknown> | null
      nvr_fw_version: string | null
      heartbeat_override_sec: number | null
    }
    for (const row of ((data ?? []) as unknown as Row[])) {
      next.set(row.id, {
        storeId:               row.id,
        storeName:             row.name,
        nvrVendor:             row.nvr_vendor as TenantStore['nvrVendor'],
        nvrEndpoint:           row.nvr_endpoint,
        nvrCredentialsRef:     row.nvr_credentials_ref,
        nvrOptions:            row.nvr_options ?? {},
        nvrFwVersion:          row.nvr_fw_version,
        deploymentMode:        row.deployment_mode as TenantStore['deploymentMode'],
        heartbeatOverrideSec:  row.heartbeat_override_sec,
      })
    }

    // diff: added / removed
    for (const [id, t] of next) {
      if (!this.tenants.has(id)) this.onAdd(t)
    }
    for (const id of this.tenants.keys()) {
      if (!next.has(id)) this.onRemove(id)
    }
    this.tenants = next
    // F50.C: メトリクス更新
    m_tenants_assigned.set(this.tenants.size)
  }

  list(): TenantStore[] {
    return [...this.tenants.values()]
  }

  get(storeId: string): TenantStore | undefined {
    return this.tenants.get(storeId)
  }

  get size(): number {
    return this.tenants.size
  }
}
