/**
 * F48.B: 中央モード共通型
 */
import type { NvrVendor } from '../../adapters/_base'

/** 中央ノードが「自分が担当」している店舗の最小情報 */
export interface TenantStore {
  storeId:               string
  storeName:             string
  nvrVendor:             NvrVendor | null
  nvrEndpoint:           string | null
  nvrCredentialsRef:     string | null
  nvrOptions:            Record<string, unknown>
  nvrFwVersion:          string | null
  deploymentMode:        'per_store_minipc' | 'central_aggregator'
  /** F51.B: per-store HB 間隔オーバーライド (秒)。null なら deployment_mode のデフォルト */
  heartbeatOverrideSec:  number | null
}

/** 中央 runner の起動設定 */
export interface CentralRunnerConfig {
  /** central_nodes.id (env 変数 CENTRAL_NODE_ID から取得) */
  nodeId:             string
  hostname:           string
  region?:            string
  capacityStores:     number
  /** pending_commands ポーリング間隔 (ms) */
  pollIntervalMs:     number
  /** ハートビート間隔 (秒、デフォルト 6h) */
  heartbeatSec:       number
  /** リース更新間隔 (ms、デフォルト 30s) */
  leaseRenewMs:       number
  /** リース有効期間 (秒、デフォルト 90s) */
  leaseTtlSec:        number
}
