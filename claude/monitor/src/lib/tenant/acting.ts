import 'server-only'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminUserRow, getTenantRow } from '@/lib/tenant/session'

/** 操作中テナント cookie 名（httpOnly・/api/admin/acting-tenant で設定/解除） */
export const ACTING_TENANT_COOKIE = 'acting_tenant'

/**
 * 管理画面の「テナント文脈」。
 *
 * - tenant_admin / store_manager など: 自テナント固定（tenantId = 所属テナント）。
 * - super_admin: 「操作中テナント」cookie で選んだテナントに固定。未選択なら null。
 *   店舗・ユーザ等の作成は tenantId が確定している時のみ許可し、フォームの
 *   テナント drop-down は置かない（選び間違いで他テナントに書く事故を構造的に防ぐ）。
 */
export interface AdminTenantContext {
  role: string | null
  isSuper: boolean
  /** 実効テナント（super は操作中テナント・他ロールは所属テナント）。未確定は null */
  tenantId: string | null
  /** 実効テナント名（表示用）。未確定は null */
  tenantName: string | null
  /** super_admin が操作中テナントを選択済みか（バナー表示用） */
  acting: boolean
  /**
   * 店舗限定ロール（store_manager / viewer / baggage_manager）の担当店舗ID。
   * - null       = 店舗制限なし（super_admin / tenant_admin はテナント全体を見る）
   * - string[]   = この店舗のみ（空配列＝担当なし＝何も見えない）
   */
  storeIds: string[] | null
}

/** 店舗単位に制限されるロール（テナント全体ではなく担当店舗のみ可視）。 */
const STORE_SCOPED_ROLES = new Set(['store_manager', 'viewer', 'baggage_manager'])

/**
 * @param _supa 使用しない。呼び出し側の互換のために残している引数。
 *   認証・admin_users・tenants の取得は lib/tenant/session の cache() 済みヘルパへ
 *   集約した（同一リクエスト内で resolveTenantFeatures と素材を共有し、往復を減らす）。
 */
export async function resolveAdminContext(_supa?: SupabaseClient): Promise<AdminTenantContext> {
  const none: AdminTenantContext = { role: null, isSuper: false, tenantId: null, tenantName: null, acting: false, storeIds: null }
  try {
    const me = await getAdminUserRow()
    if (!me) return none

    // 店舗限定ロールは担当店舗のみ可視。tenant_admin/super_admin はテナント全体（null）。
    const storeIds = STORE_SCOPED_ROLES.has(me.role) ? ((me.store_ids ?? []) as string[]) : null

    if (me.role !== 'super_admin') {
      if (!me.tenant_id) return { ...none, role: me.role, storeIds }
      const tn = await getTenantRow(me.tenant_id)
      return { role: me.role, isSuper: false, tenantId: me.tenant_id, tenantName: tn?.name ?? null, acting: false, storeIds }
    }

    // super_admin: cookie の操作中テナントを検証付きで解決。
    const cookieVal = (await cookies()).get(ACTING_TENANT_COOKIE)?.value
    if (!cookieVal) return { role: 'super_admin', isSuper: true, tenantId: null, tenantName: null, acting: false, storeIds: null }
    const tn = await getTenantRow(cookieVal)
    if (!tn) return { role: 'super_admin', isSuper: true, tenantId: null, tenantName: null, acting: false, storeIds: null }
    return { role: 'super_admin', isSuper: true, tenantId: tn.id, tenantName: tn.name, acting: true, storeIds: null }
  } catch {
    return none
  }
}
