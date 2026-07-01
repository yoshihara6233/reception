'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { MONITOR_STALE_SECONDS } from '@intereco/shared'
import { listPatrolCameraIds, buildCaptureCommand } from '@/lib/security/patrol-dispatch'

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

/**
 * 「今すぐ巡回」— 指定店舗のエッジに即時 capture_snapshot を発行する（A5）。
 *
 * 認可: セッションクライアントで edge_devices を店舗指定 read（RLS が可視性を絞る）＝
 * その店舗にアクセスできるユーザだけが edge を取得できる。取得できたら service client で
 * patrol_runs 起票 + pending_command 書込（cron と同じ transport・trigger='manual'）。
 */
export async function triggerManualPatrol(
  storeId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  // 認可ゲート: 店舗のエッジをセッション RLS 越しに読む。見えなければアクセス権なし。
  const { data: edge } = await supa
    .from('edge_devices')
    .select('id, pending_command, last_seen_at')
    .eq('store_id', storeId)
    .maybeSingle()
  if (!edge) return { ok: false, error: 'この店舗のエッジが見つからないか、権限がありません' }

  const staleMs = MONITOR_STALE_SECONDS * 1000
  const fresh = edge.last_seen_at && (Date.now() - new Date(edge.last_seen_at).getTime()) < staleMs
  if (!fresh) return { ok: false, error: 'エッジが応答していません（オフライン）' }
  if (edge.pending_command != null) {
    return { ok: false, error: 'エッジが処理中です。少し待って再実行してください' }
  }

  const service = createSupabaseService()
  const camIds = await listPatrolCameraIds(service, edge.id)
  if (!camIds.length) return { ok: false, error: '巡回対象カメラがありません' }

  const { data: run, error: runErr } = await service
    .from('patrol_runs')
    .insert({ store_id: storeId, trigger: 'manual', status: 'capturing' })
    .select('id')
    .maybeSingle()
  if (runErr || !run) return { ok: false, error: runErr?.message ?? '巡回の起票に失敗しました' }

  const command = buildCaptureCommand(run.id as string, camIds)
  const { error: cmdErr } = await service
    .from('edge_devices')
    .update({ pending_command: command, pending_command_at: new Date().toISOString() })
    .eq('id', edge.id)
  if (cmdErr) return { ok: false, error: cmdErr.message }

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
