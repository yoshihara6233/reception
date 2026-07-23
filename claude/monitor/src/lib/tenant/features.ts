import 'server-only'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseService } from '@/lib/supabase/server'
import { ACTING_TENANT_COOKIE } from '@/lib/tenant/acting'

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
export async function resolveTenantFeatures(supa: SupabaseClient): Promise<TenantFeatures> {
  try {
    const { data: { user } } = await supa.auth.getUser()
    if (!user) return ALL_FEATURES_ON

    const { data: me } = await supa
      .from('admin_users')
      .select('role, tenant_id')
      .eq('auth_user_id', user.id)
      .single()
    if (!me) return ALL_FEATURES_ON

    // super_admin は「操作中テナント」を選択している間だけ、そのテナントの
    // フラグでメニューを出し分ける（＝テナント視点で設定変更できる）。未選択は全ON。
    let tenantId: string | null = null
    if (me.role === 'super_admin') {
      tenantId = (await cookies()).get(ACTING_TENANT_COOKIE)?.value ?? null
    } else {
      tenantId = me.tenant_id ?? null
    }
    if (!tenantId) return ALL_FEATURES_ON

    const svc = createSupabaseService()
    const { data: tn, error } = await svc
      .from('tenants')
      .select('opt_patrol, opt_alarm, opt_baggage')
      .eq('id', tenantId)
      .single()
    // 列がまだ本番へ適用されていない場合など＝隠さない。
    if (error || !tn) return ALL_FEATURES_ON

    return {
      patrol:  !!tn.opt_patrol,
      alarm:   !!tn.opt_alarm,
      baggage: !!tn.opt_baggage,
    }
  } catch {
    return ALL_FEATURES_ON
  }
}
