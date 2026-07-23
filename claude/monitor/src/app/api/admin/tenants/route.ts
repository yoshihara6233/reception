/**
 * POST /api/admin/tenants — テナント新規作成（super_admin 限定）
 *
 * テナントは課金・データ分離の最上位境界。作成は super_admin のみ許可。
 * 実挿入は service client（RLS バイパス）で行う — 監視 admin は JWT の
 * tenant が NULL のことがあり RLS 経由だと挿入が弾かれるため（#192 と同方針）。
 *
 * 注意: tenants.plan の DB デフォルトは 'trial' だが CHECK 制約は
 * starter/standard/enterprise のみ許可＝デフォルト依存は制約違反になる。
 * 必ず plan を明示送信する（フォーム既定 'starter'）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { recordAudit } from '@/lib/admin/audit'
import { createSupabaseService } from '@/lib/supabase/server'

const Body = z.object({
  name:   z.string().trim().min(1).max(120),
  plan:   z.enum(['starter', 'standard', 'enterprise']).default('starter'),
  status: z.enum(['active', 'suspended', 'trial']).default('trial'),
  slug:   z.string().trim().toLowerCase().min(1).max(64).regex(/^[a-z0-9-]+$/, 'slug_format')
            .nullable().optional(),
})

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  if (guard.profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin_only' }, { status: 403 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  }
  const body = parsed.data

  const svc = createSupabaseService()
  const insert: Record<string, unknown> = { name: body.name, plan: body.plan, status: body.status }
  if (body.slug) insert.slug = body.slug

  const { data, error } = await svc.from('tenants').insert(insert).select('id').single()
  if (error) {
    // slug UNIQUE 衝突など
    const dup = /duplicate|unique/i.test(error.message)
    return NextResponse.json({ error: dup ? 'slug_taken' : error.message }, { status: dup ? 409 : 500 })
  }

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action:      'tenant.create',
    targetType:  'tenant',
    targetId:    data.id,
    storeId:     null,
    changes:     { name: body.name, plan: body.plan, status: body.status, slug: body.slug ?? null },
  })

  return NextResponse.json({ ok: true, id: data.id })
}
