/**
 * 中央 Supabase クライアント（鍵ローテ無停止同期対応）。
 *
 * 全モジュールはここの getSupabase() を使う。鍵は初期値 = .env の
 * SUPABASE_SERVICE_ROLE_KEY。`MONITOR_URL` を設定すると refreshSupabaseKey() が
 * device_token 認証で monitor から現行 service key を取得し、メモリ上の鍵を差し替える
 * （Supabase 側で鍵をローテしても、エッジの .env を手で書き換えずに追従できる）。
 * 取得失敗時は現行の鍵を維持（無停止フォールバック）。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { config } from './config.js'
import { logger } from './logger.js'

let currentKey = config.SUPABASE_SERVICE_ROLE_KEY
let client: SupabaseClient | null = null

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
 * monitor から現行 service key を取得して差し替える。MONITOR_URL 未設定なら no-op
 * （.env キー運用）。鍵が変わった時だけクライアントを作り直す。
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
    const j = (await res.json()) as { supabase_service_role_key?: string }
    const key = j.supabase_service_role_key
    if (key && key !== currentKey) {
      currentKey = key
      client = null   // 次回 getSupabase() で新キーで作り直す
      logger.info('bootstrap: supabase service key refreshed from monitor')
    }
  } catch (e) {
    logger.warn({ err: String(e) }, 'bootstrap: key refresh failed (keeping current key)')
  }
}

/** 起動時 refresh + 定期 refresh を開始（鍵ローテに自動追従）。 */
export function startKeySync(): void {
  void refreshSupabaseKey()
  setInterval(() => { void refreshSupabaseKey() }, config.BOOTSTRAP_INTERVAL_MS)
}
