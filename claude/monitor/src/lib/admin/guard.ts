/**
 * Admin-only request guard. Returns the authenticated user when the caller
 * has a role that allows mutating master data; otherwise returns null
 * so the route can respond 401/403.
 */
import { createSupabaseServer } from '@/lib/supabase/server'

const ADMIN_ROLES = ['super_admin', 'tenant_admin', 'store_manager'] as const

// 手荷物検査モジュールに触れられるロール。baggage_manager（手荷物検査店長）は
// これに含めるが ADMIN_ROLES には含めない — 他の管理機能（ライブ視聴・ユーザ管理等）
// には入れないため（アクセス境界は middleware でも二重に強制する）。
export const BAGGAGE_ROLES = ['super_admin', 'tenant_admin', 'store_manager', 'baggage_manager'] as const

type AdminProfile = { id: string; role: string; tenant_id: string; store_ids: string[] }

async function requireRole(allowed: readonly string[]) {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false as const, status: 401, error: 'unauthorized', supa }

  const { data: profile } = await supa
    .from('admin_users')
    .select('id, role, tenant_id, store_ids')
    .eq('auth_user_id', user.id)
    .single()

  if (!profile || !allowed.includes(profile.role)) {
    return { ok: false as const, status: 403, error: 'forbidden', supa }
  }

  return { ok: true as const, user, profile: profile as AdminProfile, supa }
}

export function requireAdmin() {
  return requireRole(ADMIN_ROLES)
}

/** 手荷物検査系の認可（baggage_manager を含む）。global admin 権限は与えない。 */
export function requireBaggageRole() {
  return requireRole(BAGGAGE_ROLES)
}
