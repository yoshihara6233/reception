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
import {
  getTenantQuota, getStoreCount, getOptionOnCount, exceedsStoreLimit,
  OPTION_KEYS, OPTION_STORE_COL, type OptionKey,
} from '@/lib/admin/tenant-quota'

const Body = z.object({
  name:      z.string().trim().min(1).max(160),
  tenant_id: z.string().uuid().nullable().optional(),
  address:   z.string().trim().nullable().optional(),
  area_code: z.string().trim().nullable().optional(),
  latitude:  z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  timezone:  z.string().trim().min(1).max(64).optional(),
  is_active: z.boolean().optional(),
  // 店舗別オプション（既定 OFF）。ON にはテナント契約＋クォータ内が必要。
  opt_patrol:  z.boolean().optional(),
  opt_alarm:   z.boolean().optional(),
  opt_baggage: z.boolean().optional(),
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

  const svc = createSupabaseService()

  // テナントの上限・契約を読む（フェイルオープン: 列未適用/失敗は無制限扱い）。
  const { limits, contract } = await getTenantQuota(svc, tenantId)

  // 店舗数上限。既存 + 1 が上限超過なら作成不可。
  const storeCount = await getStoreCount(svc, tenantId)
  if (exceedsStoreLimit(limits.stores, storeCount, 1)) {
    return NextResponse.json(
      { error: 'store_limit_exceeded', current: storeCount, limit: limits.stores },
      { status: 409 },
    )
  }

  // 作成時に ON 指定されたオプションを検査（テナント契約＋クォータ内）。
  const wantOpts: Record<OptionKey, boolean> = {
    patrol:  !!body.opt_patrol,
    alarm:   !!body.opt_alarm,
    baggage: !!body.opt_baggage,
  }
  for (const opt of OPTION_KEYS) {
    if (!wantOpts[opt]) continue
    if (!contract[opt]) {
      return NextResponse.json({ error: 'option_not_contracted', option: opt }, { status: 409 })
    }
    const onCount = await getOptionOnCount(svc, tenantId, opt)
    if (exceedsStoreLimit(limits[opt], onCount, 1)) {
      return NextResponse.json(
        { error: 'option_limit_exceeded', option: opt, current: onCount, limit: limits[opt] },
        { status: 409 },
      )
    }
  }

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
    [OPTION_STORE_COL.patrol]:  wantOpts.patrol,
    [OPTION_STORE_COL.alarm]:   wantOpts.alarm,
    [OPTION_STORE_COL.baggage]: wantOpts.baggage,
  }

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
