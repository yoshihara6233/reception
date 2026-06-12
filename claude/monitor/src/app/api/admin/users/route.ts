/**
 * POST /api/admin/users — Create a new admin user
 *
 * Flow:
 *   1. supabase.auth.admin.createUser() → auth.users row + UID
 *   2. INSERT admin_users with auth_user_id = UID
 *
 * Permissions:
 *   - super_admin: can create any role
 *   - tenant_admin: can create within own tenant, cannot create super_admin
 *   - others: 403
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'

const Body = z.object({
  email:        z.string().email(),
  password:     z.string().min(8),
  display_name: z.string().min(1),
  role:         z.enum(['super_admin', 'tenant_admin', 'store_manager', 'viewer']),
  tenant_id:    z.string().uuid().nullable().optional(),
  store_ids:    z.array(z.string().uuid()).default([]),
})

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  if (!['super_admin', 'tenant_admin'].includes(guard.profile.role)) {
    return NextResponse.json({ error: 'insufficient_role' }, { status: 403 })
  }

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  }
  const body = parsed.data

  // tenant_admin restrictions
  if (guard.profile.role === 'tenant_admin') {
    if (body.role === 'super_admin') {
      return NextResponse.json({ error: 'cannot_create_super_admin' }, { status: 403 })
    }
    if (body.tenant_id !== guard.profile.tenant_id) {
      return NextResponse.json({ error: 'cross_tenant_forbidden' }, { status: 403 })
    }
  }

  const svc = createSupabaseService()

  // 1. Create auth user
  const { data: createData, error: authErr } = await svc.auth.admin.createUser({
    email:         body.email,
    password:      body.password,
    email_confirm: true,
    user_metadata: { display_name: body.display_name },
  })
  if (authErr || !createData?.user) {
    return NextResponse.json(
      { error: 'auth_create_failed', message: authErr?.message ?? 'unknown' },
      { status: 500 },
    )
  }

  const authUserId = createData.user.id

  // 2. Insert admin_users
  const { data: row, error: insertErr } = await svc
    .from('admin_users')
    .insert({
      auth_user_id: authUserId,
      email:        body.email,
      display_name: body.display_name,
      role:         body.role,
      tenant_id:    body.tenant_id ?? null,
      store_ids:    body.store_ids ?? [],
    })
    .select('id')
    .single()

  if (insertErr || !row) {
    // Rollback auth user to avoid orphans
    await svc.auth.admin.deleteUser(authUserId).catch(() => {})
    return NextResponse.json(
      { error: 'profile_insert_failed', message: insertErr?.message ?? 'unknown' },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, id: row.id, auth_user_id: authUserId })
}
