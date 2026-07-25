/**
 * Bulk import or update stores.
 *
 * CSV columns (header row required):
 *   name, address, area_code, latitude, longitude, timezone, tenant_id, external_id
 *
 * Lookup strategy:
 *   - If `external_id` is provided and an existing row has matching `id` UUID, update by id.
 *   - Otherwise insert as a new row under tenant_id (required for inserts).
 *
 * 店舗数上限（tenants.max_stores）を尊重: 「新規挿入」行のみを対象に、テナント毎の
 * 上限を跨いで超過する行は `store_limit_exceeded` で弾く（既存 id の更新は増分なし）。
 * カウントは service client で正確に取り、行をまたいで in-memory に加算する。
 *
 * Returns per-row results so the UI can flag errors.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { parseCsv } from '@/lib/admin/csv'
import { createSupabaseService } from '@/lib/supabase/server'
import { getTenantQuota, getStoreCount } from '@/lib/admin/tenant-quota'

interface RowResult { row: number; ok: boolean; id?: string; error?: string }

// テナント毎の店舗数上限と見込み店舗数（行をまたいで加算）。
interface StoreProjection { limit: number | null; count: number }

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const text = await req.text()
  const rows = parseCsv(text)
  if (!rows.length) return NextResponse.json({ error: 'empty_csv' }, { status: 400 })

  const svc = createSupabaseService()

  // 既存 id を先読みして「更新(増分なし)」と「新規挿入(+1)」を判別する。
  const extIds = rows.map((r) => r.external_id).filter((v): v is string => !!v)
  const existingIds = new Set<string>()
  if (extIds.length) {
    const { data } = await svc.from('stores').select('id').in('id', extIds)
    ;(data ?? []).forEach((s) => existingIds.add(s.id as string))
  }

  // テナント毎の上限・見込み店舗数（行をまたいで加算）。フェイルオープン。
  const projected = new Map<string, StoreProjection>()
  async function limitFor(tid: string): Promise<StoreProjection> {
    let p = projected.get(tid)
    if (!p) {
      const [{ limits }, count] = await Promise.all([getTenantQuota(svc, tid), getStoreCount(svc, tid)])
      p = { limit: limits.stores, count }
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

    // Upsert by external_id (the row UUID if supplied)
    if (r.external_id) payload.id = r.external_id

    const isUpdate = !!r.external_id && existingIds.has(r.external_id)

    // 新規挿入のみ上限判定（更新は増分なし）。上限超過なら挿入せず弾く。
    if (!isUpdate && tenantId) {
      const p = await limitFor(tenantId)
      if (p.limit != null && p.count + 1 > p.limit) {
        results.push({ row: i + 2, ok: false, error: 'store_limit_exceeded' })
        continue
      }
    }

    const { data, error } = await guard.supa
      .from('stores')
      .upsert(payload, { onConflict: 'id' })
      .select('id')
      .single()
    if (error) { results.push({ row: i + 2, ok: false, error: error.message }); continue }

    results.push({ row: i + 2, ok: true, id: data.id })
    // 新規挿入が成功したら見込み数を加算（後続行の判定に反映）。
    if (!isUpdate && tenantId) {
      const p = projected.get(tenantId)
      if (p) p.count += 1
    }
  }

  const okCount  = results.filter((r) => r.ok).length
  const errCount = results.length - okCount
  return NextResponse.json({ total: results.length, ok: okCount, error: errCount, results })
}
