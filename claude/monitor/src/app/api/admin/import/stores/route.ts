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
 * Returns per-row results so the UI can flag errors.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { parseCsv } from '@/lib/admin/csv'

interface RowResult { row: number; ok: boolean; id?: string; error?: string }

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const text = await req.text()
  const rows = parseCsv(text)
  if (!rows.length) return NextResponse.json({ error: 'empty_csv' }, { status: 400 })

  const results: RowResult[] = []
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const lat = r.latitude  ? parseFloat(r.latitude)  : null
    const lng = r.longitude ? parseFloat(r.longitude) : null

    const payload: Record<string, unknown> = {
      name:       r.name,
      address:    r.address    || null,
      area_code:  r.area_code  || null,
      latitude:   Number.isFinite(lat as number) ? lat : null,
      longitude:  Number.isFinite(lng as number) ? lng : null,
      timezone:   r.timezone   || 'Asia/Tokyo',
      tenant_id:  r.tenant_id  || guard.profile.tenant_id,
      geocoded_at: (lat != null && lng != null) ? new Date().toISOString() : null,
    }
    if (!payload.name) { results.push({ row: i + 2, ok: false, error: 'name_required' }); continue }

    // Upsert by external_id (the row UUID if supplied)
    if (r.external_id) payload.id = r.external_id

    const { data, error } = await guard.supa
      .from('stores')
      .upsert(payload, { onConflict: 'id' })
      .select('id')
      .single()
    if (error) results.push({ row: i + 2, ok: false, error: error.message })
    else       results.push({ row: i + 2, ok: true,  id: data.id })
  }

  const okCount  = results.filter((r) => r.ok).length
  const errCount = results.length - okCount
  return NextResponse.json({ total: results.length, ok: okCount, error: errCount, results })
}
