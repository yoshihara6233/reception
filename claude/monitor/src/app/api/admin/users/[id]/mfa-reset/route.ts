/**
 * GET  /api/admin/users/[id]/mfa-reset — その利用者が多要素を登録しているか（件数）
 * POST /api/admin/users/[id]/mfa-reset — その利用者の多要素をすべて外す（端末の紛失など・2026-10-28）
 *
 * 管理者は**本人であることを確かめてから**外す（電話・対面など。画面で確かめを促す）。
 * 外すと、その人は次のログインからパスワードだけで入れる。もう一度使うなら本人が登録し直す。
 *
 * Permissions（利用者の編集 PUT と同じ）:
 *   - super_admin: どの利用者も
 *   - tenant_admin: 自分のテナントの利用者だけ。super_admin は外せない
 */
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/admin/audit'

type Ctx = { params: Promise<{ id: string }> }

async function loadTarget(id: string) {
  const guard = await requireAdmin()
  if (!guard.ok) return { res: NextResponse.json({ error: guard.error }, { status: guard.status }) }
  if (!['super_admin', 'tenant_admin'].includes(guard.profile.role)) {
    return { res: NextResponse.json({ error: 'insufficient_role' }, { status: 403 }) }
  }
  const svc = createSupabaseService()
  const { data: target, error } = await svc
    .from('admin_users')
    .select('id, auth_user_id, tenant_id, role, email')
    .eq('id', id)
    .single()
  if (error || !target) return { res: NextResponse.json({ error: 'not_found' }, { status: 404 }) }
  if (guard.profile.role === 'tenant_admin' &&
      (target.tenant_id !== guard.profile.tenant_id || target.role === 'super_admin')) {
    return { res: NextResponse.json({ error: 'cross_tenant_forbidden' }, { status: 403 }) }
  }
  return { guard, svc, target }
}

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const t = await loadTarget(id)
  if ('res' in t) return t.res
  const { data, error } = await t.svc.auth.admin.mfa.listFactors({ userId: t.target.auth_user_id })
  if (error) return NextResponse.json({ error: 'mfa_list_failed' }, { status: 502 })
  const verified = (data?.factors ?? []).filter((f) => f.status === 'verified').length
  return NextResponse.json({ factors: verified })
}

export async function POST(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const t = await loadTarget(id)
  if ('res' in t) return t.res
  const { data, error } = await t.svc.auth.admin.mfa.listFactors({ userId: t.target.auth_user_id })
  if (error) return NextResponse.json({ error: 'mfa_list_failed' }, { status: 502 })
  let removed = 0
  for (const f of data?.factors ?? []) {
    const { error: delErr } = await t.svc.auth.admin.mfa.deleteFactor({ id: f.id, userId: t.target.auth_user_id })
    if (delErr) return NextResponse.json({ error: 'mfa_delete_failed', removed }, { status: 502 })
    removed++
  }
  await recordAudit(t.guard.supa, {
    actorUserId: t.guard.user.id,
    action:      'user.mfa_reset',
    targetType:  'user',
    targetId:    id,
    storeId:     null,
    changes:     { email: t.target.email, removed_factors: removed },
  })
  return NextResponse.json({ removed })
}
