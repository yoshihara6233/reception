'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer } from '@/lib/supabase/server'

/**
 * 監視員が finding をトリアージする（現認→異常確定 / 誤検知）。
 * RLS の *_modify ポリシー（admin role）で書込みを許可。
 */
export async function updateFindingStatus(
  findingId: string,
  status: 'confirmed' | 'false_positive' | 'review',
): Promise<{ ok: boolean; error?: string }> {
  const supa = await createSupabaseServer()

  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  // reviewer = admin_users.id for this auth user
  const { data: admin } = await supa
    .from('admin_users')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  const { error } = await supa
    .from('patrol_findings')
    .update({
      status,
      reviewed_by: admin?.id ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', findingId)

  if (error) return { ok: false, error: error.message }

  revalidatePath('/security')
  return { ok: true }
}

/** 店舗の警備設定を upsert（スケジュール・AI・通知先・有効化）。 */
export async function upsertSecuritySettings(input: {
  storeId: string
  scheduleMode: 'interval' | 'fixed'
  patrolIntervalMin: number
  activeFrom: string
  activeTo: string
  activeDays: number[]
  patrolTimes: string[]
  aiEnabled: boolean
  aiDailyCap: number
  notifyEmails: string[]
  reportShowVerification: boolean
  enabled: boolean
}): Promise<{ ok: boolean; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  // 入力検証: HH:MM 形式
  const hhmm = /^([01]\d|2[0-4]):[0-5]\d$/
  if (input.scheduleMode === 'interval') {
    if (!hhmm.test(input.activeFrom) || !hhmm.test(input.activeTo)) {
      return { ok: false, error: '時刻は HH:MM 形式で入力してください' }
    }
  } else {
    if (input.patrolTimes.length === 0) {
      return { ok: false, error: '指定時刻を1つ以上入力してください' }
    }
    if (!input.patrolTimes.every((t) => hhmm.test(t))) {
      return { ok: false, error: '指定時刻は HH:MM 形式で入力してください' }
    }
  }

  const { error } = await supa
    .from('security_settings')
    .upsert(
      {
        store_id:                 input.storeId,
        schedule_mode:            input.scheduleMode,
        patrol_interval_min:      input.patrolIntervalMin,
        active_from:              input.activeFrom,
        active_to:                input.activeTo,
        active_days:              input.activeDays,
        patrol_times:             input.patrolTimes,
        ai_enabled:               input.aiEnabled,
        ai_daily_cap:             input.aiDailyCap,
        notify_emails:            input.notifyEmails,
        report_show_verification: input.reportShowVerification,
        enabled:                  input.enabled,
      },
      { onConflict: 'store_id' },
    )

  if (error) return { ok: false, error: error.message }
  revalidatePath('/security/settings')
  revalidatePath('/security')
  return { ok: true }
}

/** カメラの巡回設定を upsert（プロンプト・感度・ベースライン・有効化）。 */
export async function upsertCameraConfig(input: {
  cameraId: string
  aiPrompt: string
  sensitivity: number
  patrolEnabled: boolean
  baselineDayUrl?: string | null
  baselineNightUrl?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  const { error } = await supa
    .from('security_camera_config')
    .upsert(
      {
        camera_id:          input.cameraId,
        ai_prompt:          input.aiPrompt,
        sensitivity:        input.sensitivity,
        patrol_enabled:     input.patrolEnabled,
        baseline_day_url:   input.baselineDayUrl ?? null,
        baseline_night_url: input.baselineNightUrl ?? null,
      },
      { onConflict: 'camera_id' },
    )

  if (error) return { ok: false, error: error.message }
  revalidatePath('/security/cameras')
  return { ok: true }
}
