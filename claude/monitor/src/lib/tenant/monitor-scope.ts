import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveAdminContext, type AdminTenantContext } from './acting'
import { createSupabaseService } from '@/lib/supabase/server'

/**
 * モニター系ページ（/stores・/bcp・/alarms・/baggage・/security・/infra）の
 * テナント分離スコープ。super_admin もテナントを跨いで閲覧させないため、
 * 「操作中テナント（未選択なら null）」に紐づく店舗IDへ各クエリを絞る。
 *
 * - store 限定ロール（store_manager 等）: 担当店舗のみ。
 * - tenant_admin: 自テナントの全店舗。
 * - super_admin: 操作中テナントの全店舗。未選択なら needsTenant=true（データ非表示・選択誘導）。
 *
 * storeIds は child テーブル（bcp_events / alarm_events / patrol_* / monitor_* /
 * inspection_* 等、store_id を持つ）を `.in('store_id', storeIds)` で絞るのに使う。
 * stores 本体は `.eq('tenant_id', tenantId)` でも `.in('id', storeIds)` でも良い。
 */
export interface MonitorScope {
  ctx: AdminTenantContext
  /** super_admin が操作中テナント未選択 = データを見せずゲート表示 */
  needsTenant: boolean
  /** 実効テナント（未確定は null） */
  tenantId: string | null
  /** 可視店舗ID。空配列 = 可視0（該当なし）。needsTenant 時は使わない。 */
  storeIds: string[]
}

export async function resolveMonitorScope(supa: SupabaseClient): Promise<MonitorScope> {
  const ctx = await resolveAdminContext(supa)

  // store 限定ロール: 担当店舗のみ（RLS と二重で絞る）。
  if (ctx.storeIds) {
    return { ctx, needsTenant: false, tenantId: ctx.tenantId, storeIds: ctx.storeIds }
  }

  // テナント確定（tenant_admin / super_admin 操作中）: そのテナントの店舗ID一覧。
  if (ctx.tenantId) {
    const svc = createSupabaseService()
    const { data } = await svc.from('stores').select('id').eq('tenant_id', ctx.tenantId).limit(100_000)
    return { ctx, needsTenant: false, tenantId: ctx.tenantId, storeIds: (data ?? []).map((s) => s.id as string) }
  }

  // super_admin 未選択 / 不明ロール: テナント選択を促し、データは出さない。
  return { ctx, needsTenant: true, tenantId: null, storeIds: [] }
}
