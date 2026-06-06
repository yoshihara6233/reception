/**
 * Admin-only request guard. Returns the authenticated user when the caller
 * has a role that allows mutating master data; otherwise returns null
 * so the route can respond 401/403.
 */
import { createSupabaseServer } from '@/lib/supabase/server'

const ADMIN_ROLES = ['super_admin', 'tenant_admin', 'store_manager'] as const

export async function requireAdmin() {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false as const, status: 401, error: 'unauthorized', supa }

  const { data: profile } = await supa
    .from('admin_users')
    .select('id, role, tenant_id, store_ids')
    .eq('auth_user_id', user.id)
    .single()

  if (!profile || !ADMIN_ROLES.includes(profile.role as never)) {
    return { ok: false as const, status: 403, error: 'forbidden', supa }
  }

  return { ok: true as const, user, profile: profile as { id: string; role: string; tenant_id: string; store_ids: string[] }, supa }
}
