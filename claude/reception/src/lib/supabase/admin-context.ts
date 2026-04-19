/**
 * getAdminContext()
 *
 * Resolves the current admin user's tenant_id, role, and admin_users.id.
 *
 * Strategy (single-tenant mode — matches existing `// TODO: from auth` pattern):
 *   1. Verify the request has a valid Supabase Auth session.
 *   2. Look up admin_users by auth_user_id via service-role client (bypasses RLS).
 *   3. If no row found, auto-create one for the demo tenant (first-run bootstrap).
 *   4. Return { id, tenant_id, role, store_ids, authUserId }.
 *
 * Returns null only when there is no valid auth session at all.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { createServerSupabaseClient } from '@/lib/supabase/server'

// Hardcoded for single-tenant mode — same as stores-list, visits-list etc.
const DEMO_TENANT_ID = '00000000-0000-0000-0000-000000000001'

export interface AdminContext {
  id: string          // admin_users.id
  tenant_id: string
  role: string
  store_ids: string[]
  authUserId: string
}

export async function getAdminContext(): Promise<AdminContext | null> {
  // 1. Verify auth session
  const serverClient = await createServerSupabaseClient()
  const { data: { user }, error: authError } = await serverClient.auth.getUser()
  if (authError || !user) return null

  const supabase = createAdminClient()

  // 2. Look up admin_users (service role, bypasses RLS)
  const { data: existing } = await supabase
    .from('admin_users')
    .select('id, tenant_id, role, store_ids')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  if (existing) {
    return {
      id: existing.id,
      tenant_id: existing.tenant_id,
      role: existing.role,
      store_ids: existing.store_ids ?? [],
      authUserId: user.id,
    }
  }

  // 3. No row found — auto-create for single-tenant bootstrap
  //    (matches the seed.sql single-tenant setup)
  const { data: created, error: createError } = await supabase
    .from('admin_users')
    .insert({
      tenant_id: DEMO_TENANT_ID,
      email: user.email ?? `${user.id}@unknown.local`,
      name: user.email?.split('@')[0] ?? 'Admin',
      role: 'tenant_admin',
      auth_user_id: user.id,
    })
    .select('id, tenant_id, role, store_ids')
    .single()

  if (createError || !created) {
    console.error('[admin-context] auto-create admin_users failed:', createError)
    // Last resort: return a context with the demo tenant anyway so read operations work
    return {
      id: '00000000-0000-0000-0000-000000000000',
      tenant_id: DEMO_TENANT_ID,
      role: 'tenant_admin',
      store_ids: [],
      authUserId: user.id,
    }
  }

  return {
    id: created.id,
    tenant_id: created.tenant_id,
    role: created.role,
    store_ids: created.store_ids ?? [],
    authUserId: user.id,
  }
}
