/**
 * POST /api/admin/stores — 店舗 新規作成
 *
 * 権限: super_admin（任意テナント）/ tenant_admin（自テナント固定）のみ。
 * store_manager 等は作成不可（閲覧・編集のみ）。
 *
 * 実挿入は service client（RLS バイパス）。テナントスコープはコードで強制する
 * — 監視 admin は JWT の tenant が NULL のことがあり、stores の RLS
 * (store_isolation) 経由だと INSERT が弾かれるため（#192 と同方針）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { recordAudit } from '@/lib/admin/audit'
import { createSupabaseService } from '@/lib/supabase/server'

const Body = z.object({
  name:      z.string().trim().min(1).max(160),
  tenant_id: z.string().uuid().nullable().optional(),
  address:   z.string().trim().nullable().optional(),
  area_code: z.string().trim().nullable().optional(),
  latitude:  z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  timezone:  z.string().trim().min(1).max(64).optional(),
  is_active: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  if (!['super_admin', 'tenant_admin'].includes(guard.profile.role)) {
    return NextResponse.json({ error: 'insufficient_role' }, { status: 403 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  }
  const body = parsed.data

  // テナントスコープをコードで強制: tenant_admin は自テナント固定。
  const tenantId = guard.profile.role === 'super_admin'
    ? (body.tenant_id ?? null)
    : guard.profile.tenant_id
  if (!tenantId) return NextResponse.json({ error: 'tenant_required' }, { status: 400 })

  const lat = body.latitude ?? null
  const lng = body.longitude ?? null

  const insert: Record<string, unknown> = {
    name:       body.name,
    tenant_id:  tenantId,
    address:    body.address ?? null,
    area_code:  body.area_code ?? null,
    latitude:   lat,
    longitude:  lng,
    timezone:   body.timezone ?? 'Asia/Tokyo',
    is_active:  body.is_active ?? true,
    geocoded_at: lat != null && lng != null ? new Date().toISOString() : null,
  }

  const svc = createSupabaseService()
  const { data, error } = await svc.from('stores').insert(insert).select('id').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action:      'store.create',
    targetType:  'store',
    targetId:    data.id,
    storeId:     data.id,
    changes:     { name: body.name, tenant_id: tenantId, area_code: body.area_code ?? null },
  })

  return NextResponse.json({ ok: true, id: data.id })
}
