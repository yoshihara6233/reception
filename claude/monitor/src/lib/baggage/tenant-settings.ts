/**
 * 手荷物検査のテナント共通設定（全店舗同一）
 *
 * 保持日数・NVR保持・STEP無操作タイムアウト・端末モード・音声・検査STEP文言は
 * baggage_tenant_settings（テナント単位）に集約。店舗固有は inspection_settings の
 * enabled / camera_ids のみ。キオスク・管理画面・日次バッチはここから共通設定を読む。
 */
import { normalizeAnnounceSteps, type AnnounceStep, type TerminalMode } from './inspection-flow'

export interface BaggageTenantSettings {
  retentionDays: number
  nvrRetentionDays: number
  timeoutSec: number
  terminalMode: TerminalMode
  audioEnabled: boolean
  audioVolume: number
  steps: AnnounceStep[]
}

export const DEFAULT_TENANT_SETTINGS: BaggageTenantSettings = {
  retentionDays: 60,
  nvrRetentionDays: 14,
  timeoutSec: 120,
  terminalMode: 'both',
  audioEnabled: true,
  audioVolume: 1,
  steps: normalizeAnnounceSteps(undefined),
}

/** DB 行 → 共通設定（行が無ければ既定）。 */
export function rowToTenantSettings(s: Record<string, unknown> | null | undefined): BaggageTenantSettings {
  if (!s) return { ...DEFAULT_TENANT_SETTINGS }
  return {
    retentionDays: Number(s.retention_days) || 60,
    nvrRetentionDays: Number(s.nvr_retention_days) || 14,
    timeoutSec: Number(s.inspection_timeout_sec) || 120,
    terminalMode: (s.terminal_mode ?? 'both') as TerminalMode,
    audioEnabled: s.audio_enabled !== false,
    audioVolume: Number(s.audio_volume ?? 1),
    steps: normalizeAnnounceSteps(s.announce_steps),
  }
}

const COLS = 'retention_days, nvr_retention_days, inspection_timeout_sec, terminal_mode, audio_enabled, audio_volume, announce_steps'

/** テナントの共通設定を読む（任意の supabase クライアント・行なしは既定）。 */
export async function loadTenantSettings(
  supa: { from: (t: string) => any }, // eslint-disable-line @typescript-eslint/no-explicit-any
  tenantId: string,
): Promise<BaggageTenantSettings> {
  const { data } = await supa
    .from('baggage_tenant_settings')
    .select(COLS)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return rowToTenantSettings(data as Record<string, unknown> | null)
}
