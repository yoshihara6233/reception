import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 発報に付けるカメラが、その店舗のものかを確かめる（ASVS 2.2.3・8.4.1）。
 *
 * エッジの受け口（/api/alarms/ingest）はサーバの接続（service_role）で書くので RLS が効かない。
 * 以前は camera_id を見ずに記録していたため、エッジが**別の店舗（別テナント）のカメラ**を
 * 付けた発報を作れた（通知や画面にそのカメラの名前が出る）。
 * 店舗は DB の store_of_camera（カメラ → 録画機 → エッジ → 店舗）で引く。RLS のポリシーと同じ関数。
 *
 *   ok          … その店舗のカメラ
 *   invalid     … UUID の形でない
 *   other_store … 別の店舗のカメラ・存在しないカメラ
 *   error       … 確かめられなかった（呼び出し側は記録しない＝フェイルクローズ）
 */
export type CameraScope = 'ok' | 'invalid' | 'other_store' | 'error'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function cameraScope(
  svc: Pick<SupabaseClient, 'rpc'>,
  cameraId: string,
  storeId: string,
): Promise<CameraScope> {
  if (!UUID_RE.test(cameraId)) return 'invalid'
  const { data, error } = await svc.rpc('store_of_camera', { p_camera: cameraId })
  if (error) return 'error'
  return typeof data === 'string' && data.toLowerCase() === storeId.toLowerCase() ? 'ok' : 'other_store'
}
