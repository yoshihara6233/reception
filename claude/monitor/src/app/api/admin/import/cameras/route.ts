/**
 * Bulk import cameras for existing recorders.
 *
 * CSV columns:
 *   recorder_id, channel, name, grid_pos, enabled
 *
 * Upsert on (recorder_id, channel).
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { parseCsv } from '@/lib/admin/csv'
import { recordAudit } from '@/lib/admin/audit'

interface RowResult { row: number; ok: boolean; error?: string }

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const rows = parseCsv(await req.text())
  if (!rows.length) return NextResponse.json({ error: 'empty_csv' }, { status: 400 })

  const results: RowResult[] = []
  const batch: Record<string, unknown>[] = []

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const ch  = parseInt(r.channel, 10)
    const gp  = parseInt(r.grid_pos, 10)
    if (!r.recorder_id) { results.push({ row: i + 2, ok: false, error: 'recorder_id_required' }); continue }
    if (!Number.isFinite(ch) || ch < 1 || ch > 64) { results.push({ row: i + 2, ok: false, error: 'invalid_channel' }); continue }
    if (!Number.isFinite(gp) || gp < 0 || gp > 15) { results.push({ row: i + 2, ok: false, error: 'invalid_grid_pos' }); continue }

    batch.push({
      recorder_id: r.recorder_id,
      channel:     ch,
      name:        r.name || `ch${ch}`,
      grid_pos:    gp,
      enabled:     (r.enabled ?? 'true').toLowerCase() !== 'false',
    })
    results.push({ row: i + 2, ok: true })
  }

  if (batch.length) {
    const { error } = await guard.supa
      .from('recorder_cameras')
      .upsert(batch, { onConflict: 'recorder_id,channel' })
    if (error) {
      // mark all as failed
      results.forEach((r) => { if (r.ok) { r.ok = false; r.error = error.message } })
    }
  }

  const okCount  = results.filter((r) => r.ok).length

  // 監査: 一括投入は 1 操作 = 1 行（件数サマリのみ）。
  if (okCount > 0) {
    await recordAudit(guard.supa, {
      actorUserId: guard.user.id,
      action:      'camera.import',
      targetType:  'recorder_cameras',
      targetId:    null,
      storeId:     null,
      changes:     { total: results.length, ok: okCount, error: results.length - okCount },
    })
  }

  return NextResponse.json({ total: results.length, ok: okCount, error: results.length - okCount, results })
}
