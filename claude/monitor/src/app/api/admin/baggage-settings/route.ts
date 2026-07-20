/**
 * PUT /api/admin/baggage-settings — 手荷物検査のテナント共通設定を更新
 *
 * 保持日数・NVR保持・STEP無操作タイムアウト・端末モード・音声・検査STEP文言を
 * baggage_tenant_settings（テナント単位）へ upsert。super_admin / tenant_admin のみ。
 * 対象テナントは操作者の admin_users.tenant_id（super_admin は body.tenantId 指定可）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/admin/audit'
import { normalizeAnnounceSteps, STEP_TEXT_MAX } from '@/lib/baggage/inspection-flow'

const Body = z.object({
  tenantId: z.string().uuid().optional(),   // super_admin のみ指定可
  retentionDays: z.number().int().min(1).max(365),
  nvrRetentionDays: z.number().int().min(3).max(90),
  timeoutSec: z.number().int().min(30).max(600),
  terminalMode: z.enum(['both', 'entry_only', 'exit_only']),
  audioEnabled: z.boolean(),
  audioVolume: z.number().min(0).max(1),
  steps: z.array(z.object({ order: z.number(), text: z.string().max(STEP_TEXT_MAX) })).max(10),
  consentText: z.string().max(4000).optional(),
})

export async function PUT(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })
  const body = parsed.data

  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  // 共通設定を変えられるのは super_admin / tenant_admin のみ（店長は不可）。
  if (guard.profile.role !== 'super_admin' && guard.profile.role !== 'tenant_admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  // 対象テナント: tenant_admin は自テナント固定。super_admin は body.tenantId（無ければ自分）。
  const tenantId = guard.profile.role === 'super_admin'
    ? (body.tenantId ?? guard.profile.tenant_id)
    : guard.profile.tenant_id
  if (!tenantId) return NextResponse.json({ error: 'tenant_not_resolved' }, { status: 400 })

  const svc = createSupabaseService()
  const steps = normalizeAnnounceSteps(body.steps)

  // 同意文言: 省略時は現状維持（部分更新でも消さない）。指定時のみ版を管理:
  //   初めての文言は v1、以降は文言変更のたびに +1、無変更は据え置き。
  let consentUpdate: Record<string, unknown> = {}
  if (body.consentText !== undefined) {
    const consentText = body.consentText.trim()
    const { data: cur } = await svc
      .from('baggage_tenant_settings')
      .select('consent_text, consent_version')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    const prevText = (cur?.consent_text ?? '') as string
    const prevVersion = Number(cur?.consent_version) || 1
    const consentVersion =
      consentText === prevText ? prevVersion
      : !prevText ? 1                    // 初回の文言は v1
      : prevVersion + 1                  // 文言変更で +1
    consentUpdate = { consent_text: consentText, consent_version: consentVersion }
  }

  const { error } = await svc.from('baggage_tenant_settings').upsert({
    tenant_id: tenantId,
    retention_days: body.retentionDays,
    nvr_retention_days: body.nvrRetentionDays,
    inspection_timeout_sec: body.timeoutSec,
    terminal_mode: body.terminalMode,
    audio_enabled: body.audioEnabled,
    audio_volume: body.audioVolume,
    announce_steps: steps,
    ...consentUpdate,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'baggage.tenant_settings.update',
    targetType: 'inspection_settings',
    targetId: tenantId,
    storeId: null,
    changes: { terminalMode: body.terminalMode, retentionDays: body.retentionDays },
  })
  return NextResponse.json({ ok: true, steps })
}
