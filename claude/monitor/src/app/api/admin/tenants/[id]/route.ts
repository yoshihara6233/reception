/**
 * PUT /api/admin/tenants/[id] — テナント編集（super_admin 限定）
 *
 * name / plan / status / slug のみ更新。削除は提供しない（テナントは配下の
 * 店舗・ユーザー・エッジを所有＝誤削除の被害が甚大なため UI からは不可）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { recordAudit } from '@/lib/admin/audit'
import { createSupabaseService } from '@/lib/supabase/server'

const Body = z.object({
  name:   z.string().trim().min(1).max(120).optional(),
  plan:   z.enum(['starter', 'standard', 'enterprise']).optional(),
  status: z.enum(['active', 'suspended', 'trial']).optional(),
  slug:   z.string().trim().toLowerCase().min(1).max(64).regex(/^[a-z0-9-]+$/, 'slug_format')
            .nullable().optional(),
  opt_patrol:  z.boolean().optional(),
  opt_alarm:   z.boolean().optional(),
  opt_baggage: z.boolean().optional(),
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
