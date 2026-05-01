/**
 * 監査ログ書き込みヘルパー
 *
 * 各 API Route から呼び出す。エラーは握りつぶす（ログ失敗で本処理を妨げない）。
 *
 * action 命名規則:
 *   アクセス系  : login / logout / login_failed
 *   来訪操作   : visit_checkin / visit_checkout / visit_view / visit_export
 *   手荷物     : baggage_review / baggage_export
 *   設定       : settings_update
 *   ユーザー管理: user_create / user_update / user_delete
 *   店舗管理   : store_create / store_update / store_delete / qr_rotate
 *   事前登録   : prereg_create / prereg_delete
 */

import { createAdminClient } from '@/lib/supabase/admin'

export interface AuditLogParams {
  tenant_id: string
  admin_user_id?: string | null
  action: string            // 上記命名規則に従う
  resource_type: string     // visit / visitor / baggage / settings / user / store / area
  resource_id?: string | null
  details?: Record<string, unknown>
  ip_address?: string | null
  user_agent?: string | null
}

export async function logAudit(params: AuditLogParams): Promise<void> {
  try {
    const supabase = createAdminClient()
    await supabase.from('audit_logs').insert({
      tenant_id:     params.tenant_id,
      admin_user_id: params.admin_user_id ?? null,
      action:        params.action,
      resource_type: params.resource_type,
      resource_id:   params.resource_id ?? null,
      details:       params.details ?? {},
      ip_address:    params.ip_address ?? null,
      user_agent:    params.user_agent ?? null,
    })
  } catch {
    // ログ失敗は握りつぶす
  }
}

/** NextRequest から IP / User-Agent を取り出すユーティリティ */
export function extractRequestMeta(req: Request): { ip: string | null; userAgent: string | null } {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null
  const userAgent = req.headers.get('user-agent') ?? null
  return { ip, userAgent }
}
