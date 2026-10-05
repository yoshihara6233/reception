/**
 * PUT    /api/admin/tenants/[id] — テナント編集（super_admin 限定）
 * DELETE /api/admin/tenants/[id] — テナント削除（super_admin 限定・2026-10-05）
 *
 * PUT は name / plan / status / slug などを更新する。
 *
 * DELETE は配下（拠点・ユーザ・エッジ・レコーダ・カメラ・各種記録）ごと消す。
 * 以前は「誤削除の被害が甚大」として提供していなかったが、デモや試用で作った
 * テナントを片付ける手段が無かった。被害の大きさは変わらないので、次の安全策を付ける:
 *   1. 状態が「停止 (suspended)」のテナントだけ消せる（いきなり消せない・2 段階）
 *   2. テナント名を正確に打ち込ませる（confirm_name）
 *   3. 自分の所属テナントと、super_admin が所属するテナントは消せない（締め出し防止）
 *   4. DB の削除は 1 トランザクション（RPC admin_delete_tenant）。全部消えるか、何も消えない
 * DB の行を消したあと、ログイン用のアカウント（auth.users・ユーザとエッジの分）を消す。
 * **Storage のファイル（録画の切り出し・画像・報告書）は消さない**（今回の範囲外。残る）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { recordAudit } from '@/lib/admin/audit'
import { createSupabaseService } from '@/lib/supabase/server'

// lib/tenant/acting.ts の ACTING_TENANT_COOKIE と同じ値。あちらは server-only を
// 読み込むので、このルートの単体試験 (vitest) から辿れるよう値だけ持つ
const ACTING_TENANT_COOKIE = 'acting_tenant'

const DeleteBody = z.object({
  confirm_name: z.string(),
})

const Body = z.object({
  name:   z.string().trim().min(1).max(120).optional(),
  plan:   z.enum(['starter', 'standard', 'enterprise']).optional(),
  status: z.enum(['active', 'suspended', 'trial']).optional(),
  slug:   z.string().trim().toLowerCase().min(1).max(64).regex(/^[a-z0-9-]+$/, 'slug_format')
            .nullable().optional(),
  opt_patrol:  z.boolean().optional(),
  opt_alarm:   z.boolean().optional(),
  opt_baggage: z.boolean().optional(),
  // 数量クォータ（null=無制限へ戻す）。
  max_stores:  z.number().int().min(0).max(100000).nullable().optional(),
  max_patrol:  z.number().int().min(0).max(100000).nullable().optional(),
  max_alarm:   z.number().int().min(0).max(100000).nullable().optional(),
  max_baggage: z.number().int().min(0).max(100000).nullable().optional(),
  report_day:  z.number().int().min(1).max(28).nullable().optional(),
})

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  if (guard.profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin_only' }, { status: 403 })
  }

  const { id } = await ctx.params
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  }

  const patch: Record<string, unknown> = { ...parsed.data }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'no_fields' }, { status: 400 })
  // slug は空文字送信を NULL 化（未設定へ戻す）。
  if (patch.slug === '') patch.slug = null

  const svc = createSupabaseService()
  const { error } = await svc.from('tenants').update(patch).eq('id', id)
  if (error) {
    const dup = /duplicate|unique/i.test(error.message)
    return NextResponse.json({ error: dup ? 'slug_taken' : error.message }, { status: dup ? 409 : 500 })
  }

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action:      'tenant.update',
    targetType:  'tenant',
    targetId:    id,
    storeId:     null,
    changes:     parsed.data,
  })

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  if (guard.profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin_only' }, { status: 403 })
  }

  const { id } = await ctx.params
  const parsed = DeleteBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  }

  const svc = createSupabaseService()
  const { data: tenant } = await svc
    .from('tenants').select('id, name, status').eq('id', id).maybeSingle()
  if (!tenant) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // 安全策 1: 停止にしたテナントだけ
  if (tenant.status !== 'suspended') {
    return NextResponse.json({ error: 'not_suspended' }, { status: 409 })
  }
  // 安全策 2: 名前の打ち込み（前後の空白だけ許す）
  if (parsed.data.confirm_name.trim() !== String(tenant.name).trim()) {
    return NextResponse.json({ error: 'name_mismatch' }, { status: 400 })
  }
  // 安全策 3: 自分の所属テナントと、super_admin が所属するテナントは消さない
  if (guard.profile.tenant_id === id) {
    return NextResponse.json({ error: 'cannot_delete_own_tenant' }, { status: 409 })
  }
  const { count: supers } = await svc
    .from('admin_users').select('id', { count: 'exact', head: true })
    .eq('tenant_id', id).eq('role', 'super_admin')
  if ((supers ?? 0) > 0) {
    return NextResponse.json({ error: 'tenant_has_super_admin' }, { status: 409 })
  }

  // ログイン用のアカウントは DB の行を消すと辿れなくなるので、先に集める
  const authIds = await collectAuthUserIds(svc, id)

  // 安全策 4: DB は 1 トランザクションで消す（全部か、何も無しか）
  const { data: counts, error: rpcErr } = await svc.rpc('admin_delete_tenant', { p_tenant_id: id })
  if (rpcErr) {
    if (/tenant_not_found/.test(rpcErr.message)) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    return NextResponse.json({ error: 'delete_failed', message: rpcErr.message }, { status: 500 })
  }

  // DB からは消えたので、アカウントの削除の失敗では全体を失敗にしない（記録だけ残す）
  let authDeleted = 0
  const authFailed: string[] = []
  for (const uid of authIds) {
    const { error } = await svc.auth.admin.deleteUser(uid)
    if (error) {
      authFailed.push(uid)
      console.error('[admin/tenants DELETE] auth user deletion failed:', uid, error.message)
    } else {
      authDeleted++
    }
  }

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action:      'tenant.delete',
    targetType:  'tenant',
    targetId:    id,
    storeId:     null,
    changes:     {
      name:          tenant.name,
      counts:        counts as Record<string, number>,
      auth_deleted:  authDeleted,
      auth_failed:   authFailed,
      storage_files: 'not_deleted',
    },
  })

  const res = NextResponse.json({
    ok:     true,
    counts,
    auth:   { deleted: authDeleted, failed: authFailed.length },
  })
  // 消したテナントを「操作中」にしていたら外す（存在しないテナントの文脈を残さない）
  if (req.cookies.get(ACTING_TENANT_COOKIE)?.value === id) {
    res.cookies.delete(ACTING_TENANT_COOKIE)
  }
  return res
}

/**
 * テナント配下のログイン用アカウント（auth.users の id）を集める。
 * admin_users（そのテナントのユーザ）と edge_devices（そのテナントの拠点のエッジ）が持つ。
 * どちらも auth.users への外部キーが無く、行を消しても auth 側は残るため。
 */
async function collectAuthUserIds(
  svc: ReturnType<typeof createSupabaseService>,
  tenantId: string,
): Promise<string[]> {
  const ids = new Set<string>()
  const { data: users } = await svc
    .from('admin_users').select('auth_user_id').eq('tenant_id', tenantId)
  for (const u of users ?? []) {
    const v = (u as { auth_user_id: string | null }).auth_user_id
    if (v) ids.add(v)
  }
  const { data: stores } = await svc.from('stores').select('id').eq('tenant_id', tenantId)
  const storeIds = (stores ?? []).map((s) => (s as { id: string }).id)
  if (storeIds.length > 0) {
    const { data: edges } = await svc
      .from('edge_devices').select('auth_user_id').in('store_id', storeIds)
    for (const e of edges ?? []) {
      const v = (e as { auth_user_id: string | null }).auth_user_id
      if (v) ids.add(v)
    }
  }
  return [...ids]
}
