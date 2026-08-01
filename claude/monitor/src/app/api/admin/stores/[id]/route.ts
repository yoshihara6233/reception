/**
 * PUT /api/admin/stores/[id] — 店舗編集
 *
 * 店舗別オプション（巡回/発報/検査）の ON/OFF もここで更新する。ON への変更は
 * super_admin / tenant_admin のみ・テナントが当該機能を契約済み・かつテナントの
 * 「ON にできる店舗数」クォータ内であること（アプリ層強制）。それ以外のロールの
 * opt_* 変更は無視する（既存の店舗編集フローは壊さない）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import {
  getTenantQuota, getOptionOnCount, exceedsStoreLimit,
  OPTION_KEYS, OPTION_STORE_COL, type OptionKey,
} from '@/lib/admin/tenant-quota'
import { recordAudit } from '@/lib/admin/audit'

const Body = z.object({
  name:       z.string().min(1).optional(),
  address:    z.string().nullable().optional(),
  area_code:  z.string().nullable().optional(),
  latitude:   z.number().min(-90).max(90).nullable().optional(),
  longitude:  z.number().min(-180).max(180).nullable().optional(),
  timezone:   z.string().nullable().optional(),
  is_active:  z.boolean().optional(),
  opt_patrol:  z.boolean().optional(),
  opt_alarm:   z.boolean().optional(),
  opt_baggage: z.boolean().optional(),
})

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })

  const patch: Record<string, unknown> = { ...parsed.data }
  if (patch.latitude != null && patch.longitude != null) patch.geocoded_at = new Date().toISOString()

  // オプションの ON/OFF は super_admin / tenant_admin のみ扱える。
  const canManageOptions = ['super_admin', 'tenant_admin'].includes(guard.profile.role)
  const wantsOptionChange = OPTION_KEYS.some((o) => parsed.data[OPTION_STORE_COL[o]] !== undefined)

  // 数量上限は「保存は許可・超過は警告」のソフト運用。未契約のみハード拒否。
  const warnings: string[] = []

  if (wantsOptionChange) {
    if (!canManageOptions) {
      // 権限外のロールは opt_* を変更させない（他項目の編集は通す）。
      for (const o of OPTION_KEYS) delete patch[OPTION_STORE_COL[o]]
    } else {
      const svc = createSupabaseService()
      const { data: cur, error: curErr } = await svc
        .from('stores')
        .select('tenant_id, opt_patrol, opt_alarm, opt_baggage')
        .eq('id', id)
        .single()
      if (curErr || !cur) return NextResponse.json({ error: 'store_not_found' }, { status: 404 })
      const tenantId = cur.tenant_id as string | null
      if (!tenantId) return NextResponse.json({ error: 'tenant_required' }, { status: 400 })

      const { limits, contract } = await getTenantQuota(svc, tenantId)
      for (const opt of OPTION_KEYS) {
        const col = OPTION_STORE_COL[opt]
        const next = parsed.data[col]
        if (next === undefined) continue
        const prev = !!cur[col]
        if (next && !prev) {
          // OFF → ON: 契約はハード必須。上限超過は警告（自店舗は除外して数える）。
          if (!contract[opt]) {
            return NextResponse.json({ error: 'option_not_contracted', option: opt }, { status: 409 })
          }
          const onCount = await getOptionOnCount(svc, tenantId, opt as OptionKey, id)
          if (exceedsStoreLimit(limits[opt], onCount, 1)) warnings.push(`option_limit_exceeded:${opt}`)
        }
      }
    }
  }

  const { error } = await guard.supa.from('stores').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action:      'store.update',
    targetType:  'store',
    targetId:    id,
    storeId:     id,
    changes:     patch,
  })

  return NextResponse.json({ ok: true, warnings })
}
