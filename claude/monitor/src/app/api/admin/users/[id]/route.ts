/**
 * PUT    /api/admin/users/[id] — Update admin_users (display_name, role, tenant_id, store_ids)
 * DELETE /api/admin/users/[id] — Delete admin_users row + auth.users row
 *
 * Permissions:
 *   - super_admin: any user
 *   - tenant_admin: only same-tenant users, cannot promote to super_admin
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'

const UpdateBody = z.object({
  display_name: z.string().min(1).optional(),
  role:         z.enum(['super_admin', 'tenant_admin', 'store_manager', 'baggage_manager', 'viewer']).optional(),
  tenant_id:    z.string().uuid().nullable().optional(),
  store_ids:    z.array(z.string().uuid()).optional(),
  password:     z.string().min(8).optional(),
})

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  if (!['super_admin', 'tenant_admin'].includes(guard.profile.role)) {
    return NextResponse.json({ error: 'insufficient_role' }, { status: 403 })
  }

  const { id } = await ctx.params
  const parsed = UpdateBody.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  }
  const body = parsed.data

  const svc = createSupabaseService()

  // Load target row to enforce tenant scope and to know the auth_user_id
  const { data: target, error: loadErr } = await svc
    .from('admin_users')
    .select('id, auth_user_id, tenant_id, role')
    .eq('id', id)
    .single()
  if (loadErr || !target) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // tenant_admin scope check
  if (guard.profile.role === 'tenant_admin') {
    if (target.tenant_id !== guard.profile.tenant_id) {
      return NextResponse.json({ error: 'cross_tenant_forbidden' }, { status: 403 })
    }
    if (body.role === 'super_admin') {
      return NextResponse.json({ error: 'cannot_promote_super_admin' }, { status: 403 })
    }
    if (body.tenant_id && body.tenant_id !== guard.profile.tenant_id) {
      return NextResponse.json({ error: 'cross_tenant_forbidden' }, { status: 403 })
    }
  }

  // Build patch object — only include defined fields
  const patch: Record<string, unknown> = {}
  if (body.display_name !== undefined) patch.display_name = body.display_name
  if (body.role         !== undefined) patch.role         = body.role
  if (body.tenant_id    !== undefined) patch.tenant_id    = body.tenant_id
  if (body.store_ids    !== undefined) patch.store_ids    = body.store_ids

  if (Object.keys(patch).length > 0) {
    const { error: updErr } = await svc.from('admin_users').update(patch).eq('id', id)
    if (updErr) {
      return NextResponse.json({ error: 'update_failed', message: updErr.message }, { status: 500 })
    }
  }

  // Optional: password update via auth.admin
  if (body.password && target.auth_user_id) {
    const { error: pwErr } = await svc.auth.admin.updateUserById(target.auth_user_id, {
      password: body.password,
    })
    if (pwErr) {
      return NextResponse.json({ error: 'password_update_failed', message: pwErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  if (!['super_admin', 'tenant_admin'].includes(guard.profile.role)) {
    return NextResponse.json({ error: 'insufficient_role' }, { status: 403 })
  }

  const { id } = await ctx.params

  const svc = createSupabaseService()

  // Load target to check tenant scope and to find auth_user_id
  const { data: target, error: loadErr } = await svc
    .from('admin_users')
    .select('id, auth_user_id, tenant_id, role')
    .eq('id', id)
    .single()
  if (loadErr || !target) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  // Don't allow deleting yourself (avoid lock-out)
  if (target.auth_user_id === guard.user.id) {
    return NextResponse.json({ error: 'cannot_delete_self' }, { status: 400 })
  }

  if (guard.profile.role === 'tenant_admin') {
    if (target.tenant_id !== guard.profile.tenant_id) {
      return NextResponse.json({ error: 'cross_tenant_forbidden' }, { status: 403 })
    }
    if (target.role === 'super_admin') {
      return NextResponse.json({ error: 'cannot_delete_super_admin' }, { status: 403 })
    }
  }

  // Delete profile row first, then auth user
  const { error: delErr } = await svc.from('admin_users').delete().eq('id', id)
  if (delErr) {
    return NextResponse.json({ error: 'profile_delete_failed', message: delErr.message }, { status: 500 })
  }

  if (target.auth_user_id) {
    const { error: authErr } = await svc.auth.admin.deleteUser(target.auth_user_id)
    if (authErr) {
      // Profile already gone — log but don't fail
      console.error('[admin/users DELETE] auth user deletion failed:', authErr.message)
    }
  }

  return NextResponse.json({ ok: true })
}
