'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase/server'

/**
 * 店舗の監視設定を upsert（有効化・閾値・通知先・メンテ窓）。
 * RLS の monitor_settings_modify ポリシー（admin role）で書込み許可。
 */
export async function upsertMonitorSettings(input: {
  storeId: string
  enabled: boolean
  edgeOfflineThresholdMin: number
  checkIntervalMin: number
  failThreshold: number
  okThreshold: number
  notifyEmails: string[]
  maintenanceUntil: string | null   // ISO 文字列 or null
}): Promise<{ ok: boolean; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  if (input.edgeOfflineThresholdMin < 1 || input.edgeOfflineThresholdMin > 1440) {
    return { ok: false, error: 'エッジ無応答の閾値は 1〜1440 分' }
  }
  if (input.checkIntervalMin < 1 || input.checkIntervalMin > 1440) {
    return { ok: false, error: 'チェック間隔は 1〜1440 分' }
  }

  const { error } = await supa
    .from('monitor_settings')
    .upsert(
      {
        store_id:                   input.storeId,
        enabled:                    input.enabled,
        edge_offline_threshold_min: input.edgeOfflineThresholdMin,
        check_interval_min:         input.checkIntervalMin,
        fail_threshold:             input.failThreshold,
        ok_threshold:               input.okThreshold,
        notify_emails:              input.notifyEmails,
        maintenance_until:          input.maintenanceUntil,
      },
      { onConflict: 'store_id' },
    )

  if (error) return { ok: false, error: error.message }
  revalidatePath('/infra/settings')
  revalidatePath('/infra')
  return { ok: true }
}
