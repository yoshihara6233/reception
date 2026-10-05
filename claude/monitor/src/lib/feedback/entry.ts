import 'server-only'
import { cache } from 'react'
import { createSupabaseService } from '@/lib/supabase/server'
import { getAdminUserRow } from '@/lib/tenant/session'

/**
 * 画面右上の「要望・困りごと」と、設定の「要望」を出すか（基本設計 §3.1）。
 *
 * 出すのは **テナント管理者（tenant_admin）だけ**、かつテナントが要望の受付を
 * 止めていない（tenants.feedback_enabled）とき。super_admin は運営の側なので送らない。
 * store_manager・viewer・baggage_manager にも出さない（押しても使えないボタンを出さない）。
 *
 * 判定に失敗したとき（列が未適用・取得の失敗）は **出さない** 側へ倒す。
 * 機能フラグ（resolveTenantFeatures）は隠さない側へ倒しているが、こちらは
 * 出しても API が 409 / 403 を返すだけの入口なので、出さない方が害が小さい。
 * また tenants の取得を getTenantRow に相乗りさせないのは、列が未適用の DB で
 * 機能フラグの取得まで巻き添えで落とさないため。
 */
export const resolveFeedbackEntry = cache(async (): Promise<boolean> => {
  try {
    const me = await getAdminUserRow()
    return await feedbackEntryAllowed(me, async (tenantId) => {
      const { data, error } = await createSupabaseService()
        .from('tenants')
        .select('feedback_enabled')
        .eq('id', tenantId)
        .maybeSingle()
      if (error || !data) return false
      return (data as { feedback_enabled: boolean | null }).feedback_enabled !== false
    })
  } catch {
    return false
  }
})

/** 判定の本体（テスト用に取り出したもの）。 */
export async function feedbackEntryAllowed(
  me: { role: string; tenant_id: string | null } | null,
  tenantEnabled: (tenantId: string) => Promise<boolean>,
): Promise<boolean> {
  if (!me || me.role !== 'tenant_admin' || !me.tenant_id) return false
  return tenantEnabled(me.tenant_id)
}
