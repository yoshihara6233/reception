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
import { storeIdsBelongToTenant } from '@/lib/admin/user-scope'
import { recordAudit } from '@/lib/admin/audit'

const Body = z.object({
  email:        z.string().email(),
  password:     z.string().min(8),
  display_name: z.string().min(1),
  role:         z.enum(['super_admin', 'tenant_admin', 'store_manager', 'baggage_manager', 'viewer']),
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

  // 実効テナント／店舗スコープをサーバ側で確定する（body を鵜呑みにしない）:
  //   - tenant_admin は自テナント固定。
  //   - super_admin ロールのユーザーはテナント非所属＝店舗スコープも持たない。
  //   - その他ロールはテナント必須。
  const effTenantId = guard.profile.role === 'tenant_admin'
    ? guard.profile.tenant_id
    : (body.role === 'super_admin' ? null : (body.tenant_id ?? null))
  if (body.role !== 'super_admin' && !effTenantId) {
    return NextResponse.json({ error: 'tenant_required' }, { status: 400 })
  }
  const effStoreIds = body.role === 'super_admin' ? [] : body.store_ids
  // store_ids は実効テナントの店舗のみ許可（他テナント店舗の混入＝越権付与を封じる）。
  if (!(await storeIdsBelongToTenant(svc, effStoreIds, effTenantId))) {
    return NextResponse.json({ error: 'store_ids_cross_tenant' }, { status: 400 })
  }

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
      tenant_id:    effTenantId,
      store_ids:    effStoreIds ?? [],
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

  // 監査: パスワードは記録しない。
  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action:      'user.create',
    targetType:  'user',
    targetId:    row.id,
    storeId:     null,
    changes:     { email: body.email, role: body.role, tenant_id: effTenantId, store_ids: effStoreIds },
  })

  return NextResponse.json({ ok: true, id: row.id, auth_user_id: authUserId })
}
