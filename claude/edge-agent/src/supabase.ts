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
 *
 * Phase B3: `EDGE_SCOPED_DB=true` で getSupabase() 自体がスコープトークンのクライアントを
 * 返すようになり、**全ての** DB/Storage アクセスが RLS 配下に入る（B2 の RLS が前提）。
 * この状態では service_role へのフォールバックは行わない（fail-closed）。
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

/** 現行のスコープトークン（無ければ空文字）で作ったクライアント。fail-closed の受け皿。 */
function scopedClientOrStale(): SupabaseClient {
  if (!scopedClient) {
    // apikey には anon キー、Authorization に短命トークンを載せる（RLS は user JWT を見る）。
    scopedClient = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${scopedToken ?? ''}` } },
    })
  }
  return scopedClient
}

/** スコープトークンが「今まだ十分に有効」か。 */
function scopedTokenFresh(): boolean {
  const nowSec = Math.floor(Date.now() / 1000)
  return !!scopedToken && nowSec < scopedExpEpoch - SCOPED_SKEW_SEC
}

/**
 * 全モジュール共通の Supabase クライアント。
 *
 * EDGE_SCOPED_DB=false（既定）… 従来どおり service_role。
 * EDGE_SCOPED_DB=true（Phase B3）… このエッジ専用の短命トークン。トークンが無い/
 *   期限切れでも **service_role には落ちない**（fail-closed＝越権面を作らない）。
 *   その状態の要求は 401 になるが、heartbeat のエラー処理が refreshSupabaseKey() を
 *   叩くため、bootstrap が復旧すれば自動で戻る。
 */
export function getSupabase(): SupabaseClient {
  if (config.EDGE_SCOPED_DB) return scopedClientOrStale()
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
 */
export function getScopedSupabase(): SupabaseClient | null {
  return scopedTokenFresh() ? scopedClientOrStale() : null
}

/**
 * monitor から現行 service key + scoped トークンを取得して差し替える。
 * MONITOR_URL 未設定なら no-op（.env キー運用）。変わった時だけクライアントを作り直す。
 */
export async function refreshSupabaseKey(): Promise<void> {
  if (!config.MONITOR_URL) return
  try {
    const url = `${config.MONITOR_URL.replace(/\/$/, '')}/api/edge/bootstrap`
    // 手持ちトークンの残り寿命を伝え、まだ十分なら monitor 側の再サインインを省く
    // （5分毎の pull で毎回 signInWithPassword すると GoTrue のレート上限に近づくため）。
    const headers: Record<string, string> = { 'x-device-token': config.EDGE_DEVICE_TOKEN }
    if (scopedToken && scopedExpEpoch > 0) headers['x-scoped-until'] = String(scopedExpEpoch)
    const res = await fetch(url, {
      method: 'GET',
      headers,
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
  logger.info(
    { scopedDb: config.EDGE_SCOPED_DB, scopedJobs: config.EDGE_SCOPED_JOBS },
    config.EDGE_SCOPED_DB
      ? 'supabase: scoped mode (エッジ専用トークンのみ・service_role は使わない)'
      : 'supabase: service_role mode',
  )
  void refreshSupabaseKey()
  setInterval(() => { void refreshSupabaseKey() }, config.BOOTSTRAP_INTERVAL_MS)
}
