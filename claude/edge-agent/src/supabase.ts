/**
 * 中央 Supabase クライアント（鍵ローテ無停止同期対応）。
 *
 * 全モジュールはここの getSupabase() を使う。鍵は初期値 = .env の
 * SUPABASE_SERVICE_ROLE_KEY。`MONITOR_URL` を設定すると refreshSupabaseKey() が
 * device_token 認証で monitor から現行 service key を取得し、メモリ上の鍵を差し替える
 * （Supabase 側で鍵をローテしても、エッジの .env を手で書き換えずに追従できる）。
 * 取得失敗時は現行の鍵を維持（無停止フォールバック）。
 *
 * エッジ専用スコープ鍵化 Phase B1: bootstrap は service key に加えて、このエッジ専用の
 * 短命アクセストークン(scoped_access_token/scoped_expires_at)も返す。getScopedSupabase()
 * はそのトークン(authenticated/RLS スコープ)で作ったクライアントを返す。edge_jobs ワーカ
 * だけがこれを使い、service_role の万能鍵を edge_jobs 操作から外す。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from './config.js'
import { logger } from './logger.js'
import { applyDesired, type RunnerDeps } from './ota/runner.js'

// 自律OTA: bootstrap が返す desired 版を1度に1更新だけ処理する多重起動ガード。
let otaBusy = false
const otaDeps: RunnerDeps = {
  edgeRoot: config.EDGE_ROOT,
  agentUnit: config.EDGE_AGENT_UNIT,
  minStableMs: config.OTA_MIN_STABLE_MS,
  heartbeatGraceMs: config.OTA_HEARTBEAT_GRACE_MS,
}

let currentKey = config.SUPABASE_SERVICE_ROLE_KEY
let client: SupabaseClient | null = null

// --- scoped(短命トークン)状態 ---
let scopedToken: string | null = null
let scopedExpEpoch = 0          // unix 秒。0 = 未取得。
let scopedClient: SupabaseClient | null = null
// 失効の何秒前から「期限切れ扱い」にして再取得を促すか（時計ずれ/取得遅延の余裕）。
const SCOPED_SKEW_SEC = 60

/** 現行の service key で作った（キャッシュ済み）クライアントを返す。 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(config.SUPABASE_URL, currentKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return client
}

/**
 * このエッジ専用の短命トークンで作ったクライアントを返す（Phase B1）。
 * トークン未取得 or 失効間近なら null（呼び出し側はそのtickをスキップする）。
 * apikey には anon キー、Authorization に短命トークンを載せる（RLS は user JWT を見る）。
 */
export function getScopedSupabase(): SupabaseClient | null {
  const nowSec = Math.floor(Date.now() / 1000)
  if (!scopedToken || nowSec >= scopedExpEpoch - SCOPED_SKEW_SEC) return null
  if (!scopedClient) {
    scopedClient = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${scopedToken}` } },
    })
  }
  return scopedClient
}

/**
 * monitor から現行 service key + scoped トークンを取得して差し替える。
 * MONITOR_URL 未設定なら no-op（.env キー運用）。変わった時だけクライアントを作り直す。
 */
export async function refreshSupabaseKey(): Promise<void> {
  if (!config.MONITOR_URL) return
  try {
    const url = `${config.MONITOR_URL.replace(/\/$/, '')}/api/edge/bootstrap`
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-device-token': config.EDGE_DEVICE_TOKEN },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) { logger.warn({ status: res.status }, 'bootstrap: non-OK response'); return }
    const j = (await res.json()) as {
      supabase_service_role_key?: string
      scoped_access_token?: string
      scoped_expires_at?: number
      desired_agent_version?: string | null
      desired_cloudflared_version?: string | null
    }

    const key = j.supabase_service_role_key
    if (key && key !== currentKey) {
      currentKey = key
      client = null   // 次回 getSupabase() で新キーで作り直す
      logger.info('bootstrap: supabase service key refreshed from monitor')
    }

    // scoped トークン（あれば反映）。値が変わった時だけクライアントを作り直す。
    if (j.scoped_access_token && j.scoped_access_token !== scopedToken) {
      scopedToken = j.scoped_access_token
      scopedExpEpoch = typeof j.scoped_expires_at === 'number' ? j.scoped_expires_at : 0
      scopedClient = null
      logger.info({ exp: scopedExpEpoch }, 'bootstrap: scoped access token refreshed')
    }

    // 自律OTA: desired 版を受信したら更新を試みる（EDGE_ROOT 設定時のみ実効）。
    // 多重起動ガード＋更新判断(shouldUpdateAgent)は内部で行う。fire-and-forget。
    if (config.EDGE_ROOT && !otaBusy) {
      otaBusy = true
      void applyDesired(otaDeps, {
        agent: j.desired_agent_version ?? null,
        cloudflared: j.desired_cloudflared_version ?? null,
      })
        .catch((e) => logger.warn({ err: String(e) }, 'ota: applyDesired failed'))
        .finally(() => { otaBusy = false })
    }
  } catch (e) {
    logger.warn({ err: String(e) }, 'bootstrap: key refresh failed (keeping current key)')
  }
}

/** 起動時 refresh + 定期 refresh を開始（鍵ローテ/トークン更新に自動追従）。 */
export function startKeySync(): void {
  void refreshSupabaseKey()
  setInterval(() => { void refreshSupabaseKey() }, config.BOOTSTRAP_INTERVAL_MS)
}
