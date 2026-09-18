/**
 * POST /api/admin/edges/[id]/diagnostics — 診断バンドル取得の発行（super_admin）
 *
 * DIAGNOSTICS_SPEC §2。diagnostic_bundles を pending で先置きして
 * collect_diagnostics コマンドを pending_command に書く（BCP 発令と同じ機構）。
 * 未対応ビルドは黙って読み飛ばすため、結果が来ない＝pending のまま
 * （画面側が「10 分経過で未対応 or 収集失敗」と案内する）。
 *
 * 発行のついでに 30 日超の古いバンドル（このエッジ分）を掃除する —
 * 専用 cron を増やさず、使われるたびに片づける方式。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordAudit, storeIdForEdge } from '@/lib/admin/audit'

export const dynamic = 'force-dynamic'

const BUCKET = 'diagnostics'
const LOG_HOURS = 48
const MAX_BYTES = 50 * 1024 * 1024
const RETENTION_DAYS = 30

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const svc = createSupabaseService()

  const { data: edge } = await svc
    .from('edge_devices')
    .select('id, pending_command')
    .eq('id', id)
    .maybeSingle()
  if (!edge) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  // 別コマンドの上書き事故を防ぐ（BCP 発令直後など）。取得は急がない操作なので断る側に倒す。
  if (edge.pending_command) {
    return NextResponse.json({ error: 'command_pending' }, { status: 409 })
  }

  // 30 日超の掃除（実体 → 行の順）。失敗しても発行は続ける。
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString()
  const { data: old } = await svc
    .from('diagnostic_bundles')
    .select('request_id, storage_path')
    .eq('edge_id', id)
    .lt('created_at', cutoff)
  if (old && old.length > 0) {
    const paths = old.map((o) => o.storage_path).filter((p): p is string => !!p)
    if (paths.length > 0) await svc.storage.from(BUCKET).remove(paths)
    await svc.from('diagnostic_bundles').delete().eq('edge_id', id).lt('created_at', cutoff)
  }

  const requestId = crypto.randomUUID()
  const { error: insErr } = await svc.from('diagnostic_bundles').insert({
    request_id: requestId,
    edge_id: id,
    requested_by: guard.user.id,
  })
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  const { error: cmdErr } = await svc
    .from('edge_devices')
    .update({
      pending_command: {
        action: 'collect_diagnostics',
        request_id: requestId,
        log_hours: LOG_HOURS,
        max_bytes: MAX_BYTES,
      },
      pending_command_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (cmdErr) return NextResponse.json({ error: cmdErr.message }, { status: 500 })

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'edge.collect_diagnostics',
    targetType: 'edge',
    targetId: id,
    storeId: await storeIdForEdge(guard.supa, id),
    changes: { request_id: requestId },
  })

  return NextResponse.json({ ok: true, request_id: requestId })
}
