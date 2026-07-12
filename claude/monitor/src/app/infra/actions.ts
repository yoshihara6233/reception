'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase/server'

export interface MonitorSettingsInput {
  storeId: string
  enabled: boolean
  edgeOfflineThresholdMin: number
  checkIntervalMin: number
  failThreshold: number
  okThreshold: number
  notifyEmails: string[]
  maintenanceUntil: string | null   // ISO 文字列 or null
}

function validateMonitorSettings(i: MonitorSettingsInput): string | null {
  if (i.edgeOfflineThresholdMin < 1 || i.edgeOfflineThresholdMin > 1440) return 'エッジ無応答の閾値は 1〜1440 分'
  if (i.checkIntervalMin < 1 || i.checkIntervalMin > 1440) return 'チェック間隔は 1〜1440 分'
  if (i.failThreshold < 1 || i.failThreshold > 20) return '発報閾値は 1〜20 回'
  if (i.okThreshold < 1 || i.okThreshold > 20) return '解決閾値は 1〜20 回'
  return null
}

function toRow(i: MonitorSettingsInput) {
  return {
    store_id:                   i.storeId,
    enabled:                    i.enabled,
    edge_offline_threshold_min: i.edgeOfflineThresholdMin,
    check_interval_min:         i.checkIntervalMin,
    fail_threshold:             i.failThreshold,
    ok_threshold:               i.okThreshold,
    notify_emails:              i.notifyEmails,
    maintenance_until:          i.maintenanceUntil,
  }
}

/**
 * 店舗の監視設定を upsert（有効化・閾値・通知先・メンテ窓）。
 * RLS の monitor_settings_modify ポリシー（admin role）で書込み許可。
 */
export async function upsertMonitorSettings(input: MonitorSettingsInput): Promise<{ ok: boolean; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  const verr = validateMonitorSettings(input)
  if (verr) return { ok: false, error: verr }

  const { error } = await supa
    .from('monitor_settings')
    .upsert(toRow(input), { onConflict: 'store_id' })

  if (error) return { ok: false, error: error.message }
  revalidatePath('/infra/settings')
  revalidatePath('/infra')
  return { ok: true }
}

/**
 * 監視設定の一括 upsert（/security/settings の一括設定と同形）。
 * 全行を検証してから1回の upsert で適用する（部分適用を避ける）。
 */
export async function bulkUpsertMonitorSettings(
  inputs: MonitorSettingsInput[],
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }
  if (inputs.length === 0) return { ok: false, error: '対象店舗がありません' }

  for (const i of inputs) {
    const verr = validateMonitorSettings(i)
    if (verr) return { ok: false, error: verr }
  }

  const { error } = await supa
    .from('monitor_settings')
    .upsert(inputs.map(toRow), { onConflict: 'store_id' })

  if (error) return { ok: false, error: error.message }
  revalidatePath('/infra/settings')
  revalidatePath('/infra')
  return { ok: true, count: inputs.length }
}
