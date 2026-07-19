/**
 * キオスク API の店舗ガード（M3）
 *
 * iPad は admin_users アカウント（通常 store_manager・store_ids に当該店舗）で
 * ログインして運用する。requireAdmin のロール認可に加え、baggage_store_access
 * （RLS ヘルパ）と同じ判定をコードで行い、inspection_settings.enabled の店舗のみ通す。
 *
 * 書き込みは RLS にポリシーが無い（deny）ため service client で行う — このガードを
 * 通ったリクエストのみが書けるという二段構え。
 */
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { normalizeAnnounceSteps, type AnnounceStep, type TerminalMode } from './inspection-flow'

export interface KioskSettings {
  cameraIds: string[]
  retentionDays: number
  nvrRetentionDays: number
  timeoutSec: number
  terminalMode: TerminalMode
  audioEnabled: boolean
  audioVolume: number
  steps: AnnounceStep[]
}

export type KioskGuardResult =
  | { ok: false; status: number; error: string }
  | {
      ok: true
      store: { id: string; tenantId: string; name: string }
      settings: KioskSettings
      svc: ReturnType<typeof createSupabaseService>
    }

export async function requireKioskStore(storeId: string | null | undefined): Promise<KioskGuardResult> {
  if (!storeId) return { ok: false, status: 400, error: 'storeId_required' }

  const guard = await requireAdmin()
  if (!guard.ok) return { ok: false, status: guard.status, error: guard.error }

  const svc = createSupabaseService()
  const { data: store } = await svc
    .from('stores')
    .select('id, tenant_id, name')
    .eq('id', storeId)
    .maybeSingle()
  if (!store) return { ok: false, status: 404, error: 'store_not_found' }

  const p = guard.profile
  const allowed =
    p.role === 'super_admin' ||
    (p.role === 'tenant_admin' && store.tenant_id === p.tenant_id) ||
    (p.store_ids ?? []).includes(store.id)
  if (!allowed) return { ok: false, status: 403, error: 'forbidden' }

  const { data: s } = await svc
    .from('inspection_settings')
    .select('enabled, camera_ids, retention_days, nvr_retention_days, inspection_timeout_sec, terminal_mode, audio_enabled, audio_volume, announce_steps')
    .eq('store_id', storeId)
    .maybeSingle()
  if (!s?.enabled) return { ok: false, status: 403, error: 'baggage_not_enabled' }

  return {
    ok: true,
    store: { id: store.id, tenantId: store.tenant_id, name: store.name },
    settings: {
      cameraIds: (s.camera_ids ?? []) as string[],
      retentionDays: Number(s.retention_days) || 60,
      nvrRetentionDays: Number(s.nvr_retention_days) || 14,
      timeoutSec: Number(s.inspection_timeout_sec) || 120,
      terminalMode: (s.terminal_mode ?? 'both') as TerminalMode,
      audioEnabled: s.audio_enabled !== false,
      audioVolume: Number(s.audio_volume ?? 1),
      steps: normalizeAnnounceSteps(s.announce_steps),
    },
    svc,
  }
}
