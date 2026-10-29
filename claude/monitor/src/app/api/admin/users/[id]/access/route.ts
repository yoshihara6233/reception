/**
 * GET  /api/admin/users/[id]/access — その利用者を止めているか・有効なセッションの数
 * POST /api/admin/users/[id]/access  { action: 'suspend' | 'resume' | 'revoke_sessions' }
 *
 * 利用者を 1 人だけ止める・特定の利用者のセッションを切る (2026-10-30・自主診断 ASVS 7.4.2・7.4.5)。
 * それまでは、止めるには利用者を消すしかなかった。
 *   - suspend:         Supabase Auth の ban (新しいログイン・トークンの更新・拠点の SSO を断る) + セッションを全部消す
 *   - resume:          ban を外す (利用者はもう一度ログインする)
 *   - revoke_sessions: セッションを全部消す (利用者はもう一度ログインする。止めはしない)
 * セッションを消すと、画面と API (getUser) はすぐに止まり、DB は RESTRICTIVE の user_active_only が
 * 止める (migration 20261030090000_user_suspension.sql)。
 *
 * 権限は利用者の編集・多要素を外すと同じ (lib/admin/user-access.ts)。操作は監査ログに残す。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/admin/audit'
import {
  USER_ACCESS_ACTIONS, SUSPEND_BAN_DURATION, RESUME_BAN_DURATION,
  auditActionOf, decideUserAccess, isSuspended,
} from '@/lib/admin/user-access'

type Ctx = { params: Promise<{ id: string }> }

const Body = z.object({ action: z.enum(USER_ACCESS_ACTIONS) })

async function loadTarget(id: string) {
  const guard = await requireAdmin()
  if (!guard.ok) return { res: NextResponse.json({ error: guard.error }, { status: guard.status }) }
  const svc = createSupabaseService()
  const { data: target, error } = await svc
    .from('admin_users')
    .select('id, auth_user_id, tenant_id, role, email')
    .eq('id', id)
    .single()
  if (error || !target) return { res: NextResponse.json({ error: 'not_found' }, { status: 404 }) }
  const d = decideUserAccess(
    { authUserId: guard.user.id, role: guard.profile.role, tenantId: guard.profile.tenant_id ?? null },
    { authUserId: target.auth_user_id, role: target.role, tenantId: target.tenant_id },
  )
  if (!d.ok) return { res: NextResponse.json({ error: d.error }, { status: d.status }) }
  return { guard, svc, target: target as { id: string; auth_user_id: string; tenant_id: string | null; role: string; email: string } }
}

async function readState(svc: ReturnType<typeof createSupabaseService>, authUserId: string) {
  const { data, error } = await svc.rpc('user_suspension_states', { p_users: [authUserId] })
  if (error) return null
  const row = (data as { banned_until: string | null; sessions: number }[] | null)?.[0]
  return { suspended: isSuspended(row?.banned_until), sessions: row?.sessions ?? 0 }
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const t = await loadTarget(id)
  if ('res' in t) return t.res
  const st = await readState(t.svc, t.target.auth_user_id)
  if (!st) return NextResponse.json({ error: 'state_failed' }, { status: 502 })
  return NextResponse.json(st)
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const action = parsed.data.action
  const t = await loadTarget(id)
  if ('res' in t) return t.res
  const uid = t.target.auth_user_id

  if (action === 'suspend' || action === 'resume') {
    const { error } = await t.svc.auth.admin.updateUserById(uid, {
      ban_duration: action === 'suspend' ? SUSPEND_BAN_DURATION : RESUME_BAN_DURATION,
    })
    if (error) return NextResponse.json({ error: 'ban_failed' }, { status: 502 })
  }

  let revoked = 0
  if (action === 'suspend' || action === 'revoke_sessions') {
    const { data, error } = await t.svc.rpc('revoke_user_sessions', { p_user: uid })
    if (error) return NextResponse.json({ error: 'revoke_failed' }, { status: 502 })
    revoked = typeof data === 'number' ? data : 0
  }

  await recordAudit(t.guard.supa, {
    actorUserId: t.guard.user.id,
    action:      auditActionOf(action),
    targetType:  'user',
    targetId:    id,
    storeId:     null,
    changes:     { email: t.target.email, role: t.target.role, tenant_id: t.target.tenant_id, revoked_sessions: revoked },
  })

  const st = await readState(t.svc, uid)
  return NextResponse.json({ ok: true, revoked, ...(st ?? {}) })
}
