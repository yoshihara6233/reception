import 'server-only'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ACTING_TENANT_COOKIE } from '@/lib/tenant/acting'
import { getAdminUserRow, getTenantRow } from '@/lib/tenant/session'

/**
 * テナントが有効化しているオプション機能。Monitor + BCP は基本パックのため
 * ここには含めない（常時利用可）。3つはいずれも有料オプション。
 */
export interface TenantFeatures {
  patrol: boolean   // 巡回 (/security)
  alarm: boolean    // 発報 (/alarms)
  baggage: boolean  // 手荷物検査 (/baggage, /admin/baggage)
}

// フェイルオープンの既定（隠さない）。super_admin・テナント未確定・列未適用・
// 取得失敗のいずれでもメニューを消さないための安全側の値。
export const ALL_FEATURES_ON: TenantFeatures = { patrol: true, alarm: true, baggage: true }

/**
 * 現在ユーザーのテナントが有効化しているオプションを解決する。
 * - super_admin / テナント未確定 / 取得失敗 → 全ON（フェイルオープン）。
 * - テナント配下ユーザー → 所属テナントの opt_* フラグに従う。
 * フラグは service client で読む（tenants RLS ＋ 監視admin の JWT tenant=NULL を回避）。
 */
/**
 * @param _supa 使用しない。呼び出し側の互換のために残している引数。
 *   認証・admin_users・tenants の取得は lib/tenant/session の cache() 済みヘルパへ
 *   集約した（同一リクエスト内で resolveAdminContext と素材を共有し、往復を減らす）。
 */
export async function resolveTenantFeatures(_supa?: SupabaseClient): Promise<TenantFeatures> {
  try {
    const me = await getAdminUserRow()
    if (!me) return ALL_FEATURES_ON

    // super_admin は「操作中テナント」を選択している間だけ、そのテナントの
    // フラグでメニューを出し分ける（＝テナント視点で設定変更できる）。未選択は全ON。
    const tenantId = me.role === 'super_admin'
      ? ((await cookies()).get(ACTING_TENANT_COOKIE)?.value ?? null)
      : (me.tenant_id ?? null)
    if (!tenantId) return ALL_FEATURES_ON

    // 列がまだ本番へ適用されていない場合など＝隠さない。
    const tn = await getTenantRow(tenantId)
    if (!tn) return ALL_FEATURES_ON

    return {
      patrol:  !!tn.opt_patrol,
      alarm:   !!tn.opt_alarm,
      baggage: !!tn.opt_baggage,
    }
  } catch {
    return ALL_FEATURES_ON
  }
}
