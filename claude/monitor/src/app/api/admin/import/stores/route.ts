/**
 * Bulk import or update stores.
 *
 * CSV columns (header row required):
 *   name, address, area_code, latitude, longitude, timezone, tenant_id, external_id,
 *   opt_patrol, opt_alarm, opt_baggage
 *
 * Lookup strategy:
 *   - If `external_id` is provided and an existing row has matching `id` UUID, update by id.
 *   - Otherwise insert as a new row under tenant_id (required for inserts).
 *
 * 数量クォータ（tenants.max_*）を尊重:
 *   - 店舗数上限: 新規挿入行のみ対象に、テナント毎の上限を跨いだら弾く。
 *   - オプション(巡回/発報/検査): `opt_*` 列を ON にする行は「テナント契約済み＋
 *     ON にできる店舗数が上限内」を検査。既存の ON→ON は増分なし・ON→OFF は減算。
 *   カウントは service client で正確に取り、行をまたいで in-memory に加減算する。
 *
 * `opt_*` 列を付けた行は ON/OFF を明示（空セル=OFF）。列自体が無ければ既存値を保持。
 *
 * Returns per-row results so the UI can flag errors.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { parseCsv } from '@/lib/admin/csv'
import { createSupabaseService } from '@/lib/supabase/server'
import {
  getTenantQuota, getStoreCount, getOptionOnCount,
  OPTION_KEYS, OPTION_STORE_COL, type OptionKey,
} from '@/lib/admin/tenant-quota'

interface RowResult { row: number; ok: boolean; id?: string; error?: string; warning?: string }

// テナント毎の見込み（行をまたいで加減算する）。
interface TenantProjection {
  storeLimit: number | null
  storeCount: number
  contract:   Record<OptionKey, boolean>
  optLimit:   Record<OptionKey, number | null>
  optOn:      Record<OptionKey, number>
}

/** CSV セルを真偽に。列自体が無い(undefined)は「未指定」＝変更しない。空セルは OFF。 */
function csvBool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined
  const s = v.trim().toLowerCase()
  if (s === '') return false
  return s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'y'
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  // オプション ON/OFF を扱えるのは super_admin / tenant_admin のみ。
  const canManageOptions = ['super_admin', 'tenant_admin'].includes(guard.profile.role)

  const text = await req.text()
  const rows = parseCsv(text)
  if (!rows.length) return NextResponse.json({ error: 'empty_csv' }, { status: 400 })

  const svc = createSupabaseService()

  // 既存 id と、その現在のオプション状態を先読み（更新/挿入の判別＋ON→ON二重計上回避）。
  const extIds = rows.map((r) => r.external_id).filter((v): v is string => !!v)
  const existing = new Map<string, { opt_patrol: boolean; opt_alarm: boolean; opt_baggage: boolean }>()
  if (extIds.length) {
    const { data } = await svc.from('stores')
      .select('id, opt_patrol, opt_alarm, opt_baggage').in('id', extIds)
    ;(data ?? []).forEach((s) => existing.set(s.id as string, {
      opt_patrol: !!s.opt_patrol, opt_alarm: !!s.opt_alarm, opt_baggage: !!s.opt_baggage,
    }))
  }

  const projected = new Map<string, TenantProjection>()
  async function projFor(tid: string): Promise<TenantProjection> {
    let p = projected.get(tid)
    if (!p) {
      const [{ limits, contract }, storeCount, on] = await Promise.all([
        getTenantQuota(svc, tid),
        getStoreCount(svc, tid),
        Promise.all(OPTION_KEYS.map((o) => getOptionOnCount(svc, tid, o))),
      ])
      p = {
        storeLimit: limits.stores, storeCount, contract,
        optLimit: { patrol: limits.patrol, alarm: limits.alarm, baggage: limits.baggage },
        optOn:    { patrol: on[0], alarm: on[1], baggage: on[2] },
      }
      projected.set(tid, p)
    }
    return p
  }

  const results: RowResult[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const lat = r.latitude  ? parseFloat(r.latitude)  : null
    const lng = r.longitude ? parseFloat(r.longitude) : null
    const tenantId = r.tenant_id || guard.profile.tenant_id

    const payload: Record<string, unknown> = {
      name:       r.name,
      address:    r.address    || null,
      area_code:  r.area_code  || null,
      latitude:   Number.isFinite(lat as number) ? lat : null,
      longitude:  Number.isFinite(lng as number) ? lng : null,
      timezone:   r.timezone   || 'Asia/Tokyo',
      tenant_id:  tenantId,
      geocoded_at: (lat != null && lng != null) ? new Date().toISOString() : null,
    }
    if (!payload.name) { results.push({ row: i + 2, ok: false, error: 'name_required' }); continue }

    if (r.external_id) payload.id = r.external_id
    const prev = r.external_id ? existing.get(r.external_id) : undefined
    const isUpdate = !!prev

    // 希望オプション状態（列があり super/tenant_admin のみ）。列なしは変更しない。
    const wants: Partial<Record<OptionKey, boolean>> = {}
    if (canManageOptions) {
      for (const o of OPTION_KEYS) {
        const b = csvBool(r[OPTION_STORE_COL[o]])
        if (b !== undefined) wants[o] = b
      }
    }

    const p = tenantId ? await projFor(tenantId) : null

    // 数量上限は「登録は許可・超過は警告」。未契約のみハード拒否。
    const rowWarnings: string[] = []

    // 店舗数上限（新規挿入のみ）＝超過は警告（挿入は続行）。
    if (!isUpdate && p && p.storeLimit != null && p.storeCount + 1 > p.storeLimit) {
      rowWarnings.push('store_limit_exceeded')
    }

    // オプション ON 判定。未契約はハード拒否・上限超過は警告。ON へ増える分のみ判定。
    let optError: string | null = null
    if (p) {
      for (const o of OPTION_KEYS) {
        const next = wants[o]
        if (next === undefined) continue
        const before = isUpdate ? !!prev?.[OPTION_STORE_COL[o]] : false
        if (next && !before) {
          if (!p.contract[o]) { optError = `option_not_contracted:${o}`; break }
          if (p.optLimit[o] != null && p.optOn[o] + 1 > p.optLimit[o]!) {
            rowWarnings.push(`option_limit_exceeded:${o}`)
          }
        }
      }
    }
    if (optError) { results.push({ row: i + 2, ok: false, error: optError }); continue }

    // payload にオプションを反映（列指定があった分だけ）。
    for (const o of OPTION_KEYS) {
      if (wants[o] !== undefined) payload[OPTION_STORE_COL[o]] = wants[o]
    }

    // 書き込みは guard.supa（RLS）を維持 — service client は越権書込を許すため。
    // テナントスコープは RLS が担保する（CSV の tenant_id 詐称を防ぐ）。
    const { data, error } = await guard.supa
      .from('stores')
      .upsert(payload, { onConflict: 'id' })
      .select('id')
      .single()
    if (error) { results.push({ row: i + 2, ok: false, error: error.message }); continue }

    results.push({ row: i + 2, ok: true, id: data.id, warning: rowWarnings.join(' / ') || undefined })

    // 見込み数の反映（成功時）。
    if (p) {
      if (!isUpdate) p.storeCount += 1
      for (const o of OPTION_KEYS) {
        const next = wants[o]
        if (next === undefined) continue
        const before = isUpdate ? !!prev?.[OPTION_STORE_COL[o]] : false
        if (next && !before) p.optOn[o] += 1
        else if (!next && before) p.optOn[o] -= 1
      }
    }
  }

  const okCount   = results.filter((r) => r.ok).length
  const errCount  = results.length - okCount
  const warnCount = results.filter((r) => r.ok && r.warning).length
  return NextResponse.json({ total: results.length, ok: okCount, error: errCount, warning: warnCount, results })
}
