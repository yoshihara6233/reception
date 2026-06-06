/**
 * F46.4: 両 app 共通の定数
 *
 * monitor (Next.js) と edge-agent (Bun) が同じ値を見るように集約。
 * 設定の食い違いで「monitor 画面と edge-agent の挙動がずれる」事故を防ぐ。
 */

// ─── ハートビート間隔 ────────────────────────────────────────────────────────

/**
 * 現行 per_store_minipc モードのハートビート間隔 (秒)。60秒で死活検知。
 */
export const HEARTBEAT_INTERVAL_PER_STORE_SEC = 60

/**
 * Tier 3 中央集約モードのハートビート間隔 (秒)。
 * 6 時間 = 21600秒。長期間隔は ONVIF event push と組合せて運用。
 */
export const HEARTBEAT_INTERVAL_CENTRAL_SEC = 6 * 60 * 60

// ─── コマンド再試行 ──────────────────────────────────────────────────────────

export const COMMAND_RETRY_MAX = 2
export const COMMAND_RETRY_BACKOFF_MS = [200, 500, 1500]

// ─── スループット / 同時実行制限 ─────────────────────────────────────────────

/** 1 中央ノードが担当できる店舗数の標準値 (Tier 3) */
export const CENTRAL_NODE_DEFAULT_CAPACITY = 5_000

/** Adapter cache の最大保持数 */
export const ADAPTER_CACHE_MAX_SIZE = 12_000

// ─── BCP / Security ──────────────────────────────────────────────────────────

/** BCP 8 枚タイムラインの標準オフセット (分) */
export const BCP_SNAPSHOT_OFFSETS_MIN = [-5, 0, 5, 10, 15, 20, 25, 30] as const

/** Supabase Storage バケット名 */
export const STORAGE_BUCKETS = {
  bcpClips:    'bcp-clips',
  reports:     'reports',
  patrol:      'patrol-snapshots',
} as const

// ─── 環境変数キー (両 app から参照する名前を一元化) ──────────────────────────

export const ENV_KEYS = {
  supabaseUrl:         'NEXT_PUBLIC_SUPABASE_URL',
  supabaseAnonKey:     'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  supabaseServiceKey:  'SUPABASE_SERVICE_ROLE_KEY',
  liveKitUrl:          'LIVEKIT_URL',
  liveKitApiKey:       'LIVEKIT_API_KEY',
  liveKitApiSecret:    'LIVEKIT_API_SECRET',
} as const
