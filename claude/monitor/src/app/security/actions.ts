'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { MONITOR_STALE_SECONDS } from '@intereco/shared'
import { listPatrolCameraIds, buildCaptureCommand } from '@/lib/security/patrol-dispatch'
import { generateAndStoreRunReport } from '@/lib/security/patrol-report'

export interface ReportSnapshot { url: string; camera: string; at: string }

/**
 * レポート（security_reports 1件）の対象期間・店舗に属する巡回スナップショットを列挙する。
 * 一覧の「画像」ビューアが使う。URL は認証付き署名プロキシのパス（同一オリジンの <img> で開ける）。
 * 認可はセッション RLS（patrol_runs/patrol_findings は store-scoped）に委ねる。
 * ※ スナップは 30 日で purge されるため、古いレポートは PDF 内の焼き込み画像のみ。
 */
export async function listReportSnapshots(
  reportId: string,
): Promise<{ ok: boolean; snapshots?: ReportSnapshot[]; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  const { data: report } = await supa
    .from('security_reports')
    .select('id, store_id, period_from, period_to')
    .eq('id', reportId)
    .maybeSingle()
  if (!report) return { ok: false, error: 'レポートが見つからないか、権限がありません' }

  const { data: runs } = await supa
    .from('patrol_runs')
    .select('id, started_at')
    .eq('store_id', report.store_id)
    .gte('started_at', report.period_from)
    .lte('started_at', report.period_to)
    .limit(2000)
  const runIds = (runs ?? []).map((r) => r.id as string)
  const runAt = new Map((runs ?? []).map((r) => [r.id as string, r.started_at as string]))
  if (!runIds.length) return { ok: true, snapshots: [] }

  const { data: fs } = await supa
    .from('patrol_findings')
    .select('run_id, snapshot_url, recorder_cameras ( name )')
    .in('run_id', runIds)
    .not('snapshot_url', 'is', null)
    .limit(5000)

  const snapshots: ReportSnapshot[] = ((fs ?? []) as unknown as Array<{
    run_id: string; snapshot_url: string; recorder_cameras: { name: string } | { name: string }[] | null
  }>).map((f) => {
    const rc = f.recorder_cameras
    const camera = (Array.isArray(rc) ? rc[0]?.name : rc?.name) ?? '—'
    return { url: f.snapshot_url, camera, at: runAt.get(f.run_id) ?? '' }
  }).sort((a, b) => a.at.localeCompare(b.at) || a.camera.localeCompare(b.camera))

  return { ok: true, snapshots }
}

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

/**
 * 単一巡回サイクルのレポート PDF をその場で生成し、公開 URL を返す（A4拡張）。
 * 「今すぐ巡回」を含む任意のサイクルを、日次を待たず即 PDF 化する。
 *
 * 認可: patrol_runs をセッション RLS 越しに読む（store-scoped）。見えれば権限あり。
 * 生成は service client（Storage download / reports バケット書込）。
 */
export async function generateRunReportPdf(
  runId: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }

  // 認可ゲート: run をセッション RLS 越しに読めれば権限あり。
  const { data: run } = await supa
    .from('patrol_runs')
    .select('id')
    .eq('id', runId)
    .maybeSingle()
  if (!run) return { ok: false, error: '巡回が見つからないか、権限がありません' }

  try {
    const service = createSupabaseService()
    const { url } = await generateAndStoreRunReport(service, runId)
    revalidatePath('/security/reports')
    return { ok: true, url }
  } catch (e) {
    return { ok: false, error: `PDF 生成に失敗しました: ${(e as Error).message}` }
  }
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
