import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * store_ids がすべて tenantId に属する店舗かを検証する。
 *
 * admin_users.store_ids は RLS の `... = ANY(auth_user_store_ids())` 経由で
 * その店舗への SELECT 権限を付与するため、他テナントの店舗IDを混ぜると
 * 越権閲覧を許してしまう。ユーザー作成/更新時に必ず本チェックを通すこと。
 *
 * - 空配列は常に OK。
 * - tenantId=null（＝global な super_admin ユーザー）は店舗スコープを持てないので
 *   store_ids が非空なら false。
 */
export async function storeIdsBelongToTenant(
  svc: SupabaseClient,
  storeIds: string[],
  tenantId: string | null,
): Promise<boolean> {
  const ids = [...new Set(storeIds)]
  if (ids.length === 0) return true
  if (!tenantId) return false
  const { data, error } = await svc
    .from('stores')
    .select('id')
    .in('id', ids)
    .eq('tenant_id', tenantId)
  if (error) return false
  return (data?.length ?? 0) === ids.length
}
