/**
 * PUT /api/baggage/settings — 店舗の手荷物検査設定を更新（M4）
 *
 * inspection_settings を upsert する。camera_ids はその店舗配下の
 * recorder_cameras（recorders → edge_devices.store_id）に限定して受理。
 * 変更は admin_audit_log（baggage.settings.update）に記録。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBaggageAccess } from '@/lib/baggage/kiosk-guard'
import { recordAudit } from '@/lib/admin/audit'
import { normalizeAnnounceSteps, STEP_TEXT_MAX } from '@/lib/baggage/inspection-flow'

const Body = z.object({
  storeId: z.string().uuid(),
  enabled: z.boolean(),
  cameraIds: z.array(z.string().uuid()).max(2),
  retentionDays: z.number().int().min(1).max(365),
  nvrRetentionDays: z.number().int().min(3).max(90),
  timeoutSec: z.number().int().min(30).max(600),
  terminalMode: z.enum(['both', 'entry_only', 'exit_only']),
  audioEnabled: z.boolean(),
  audioVolume: z.number().min(0).max(1),
  steps: z.array(z.object({ order: z.number(), text: z.string().max(STEP_TEXT_MAX) })).max(10),
})

export async function PUT(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  const body = parsed.data

  const guard = await requireBaggageAccess(body.storeId)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const { svc, store } = guard

  // camera_ids は店舗配下のカメラのみ受理（他店舗カメラの混入＝越権を防ぐ）
  if (body.cameraIds.length > 0) {
    const { data: cams } = await svc
      .from('recorder_cameras')
      .select('id, recorders!inner ( edge_devices!inner ( store_id ) )')
      .in('id', body.cameraIds)
      .eq('recorders.edge_devices.store_id', store.id)
    const validIds = new Set(((cams ?? []) as { id: string }[]).map((c) => c.id))
    const invalid = body.cameraIds.filter((id) => !validIds.has(id))
    if (invalid.length > 0) {
      return NextResponse.json({ error: 'camera_not_in_store', invalid }, { status: 400 })
    }
  }

  const steps = normalizeAnnounceSteps(body.steps)
  const { error } = await svc.from('inspection_settings').upsert({
    store_id: store.id,
    tenant_id: store.tenantId,
    enabled: body.enabled,
    camera_ids: body.cameraIds,
    retention_days: body.retentionDays,
    nvr_retention_days: body.nvrRetentionDays,
    inspection_timeout_sec: body.timeoutSec,
    terminal_mode: body.terminalMode,
    audio_enabled: body.audioEnabled,
    audio_volume: body.audioVolume,
    announce_steps: steps,
    updated_at: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'baggage.settings.update',
    targetType: 'inspection_settings',
    targetId: store.id,
    storeId: store.id,
    changes: { enabled: body.enabled, cameraIds: body.cameraIds, terminalMode: body.terminalMode },
  })
  return NextResponse.json({ ok: true, steps })
}
