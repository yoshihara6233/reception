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
/** 1店舗へ手動巡回を発火する内部処理（authz は呼び出し側で getUser 済み前提）。 */
async function dispatchManualPatrol(
  supa: Awaited<ReturnType<typeof createSupabaseServer>>,
  service: ReturnType<typeof createSupabaseService>,
  storeId: string,
): Promise<{ ok: boolean; error?: string }> {
  // 認可ゲート: 店舗のエッジをセッション RLS 越しに読む。見えなければアクセス権なし。
  const { data: edge } = await supa
    .from('edge_devices')
    .select('id, pending_command, last_seen_at')
    .eq('store_id', storeId)
    .maybeSingle()
  if (!edge) return { ok: false, error: 'エッジ未登録／権限なし' }

  const staleMs = MONITOR_STALE_SECONDS * 1000
  const fresh = edge.last_seen_at && (Date.now() - new Date(edge.last_seen_at).getTime()) < staleMs
  if (!fresh) return { ok: false, error: 'オフライン' }
  if (edge.pending_command != null) return { ok: false, error: '処理中' }

  const camIds = await listPatrolCameraIds(service, edge.id)
  if (!camIds.length) return { ok: false, error: '巡回対象カメラなし' }

  const { data: run, error: runErr } = await service
    .from('patrol_runs')
    .insert({ store_id: storeId, trigger: 'manual', status: 'capturing' })
    .select('id')
    .maybeSingle()
  if (runErr || !run) return { ok: false, error: runErr?.message ?? '起票失敗' }

  const command = buildCaptureCommand(run.id as string, camIds)
  const { error: cmdErr } = await service
    .from('edge_devices')
    .update({ pending_command: command, pending_command_at: new Date().toISOString() })
    .eq('id', edge.id)
  if (cmdErr) return { ok: false, error: cmdErr.message }
  return { ok: true }
}

export async function triggerManualPatrol(
  storeId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }
  const res = await dispatchManualPatrol(supa, createSupabaseService(), storeId)
  if (res.ok) revalidatePath('/security')
  return res
}

/**
 * 複数店舗へ一括で「今すぐ巡回」を発火する（巡回ランチャー用）。
 * 店舗ごとに成否を返す（オフライン/処理中/カメラなし等は個別にエラー）。
 */
export async function triggerManualPatrols(
  storeIds: string[],
): Promise<{ ok: boolean; results?: Array<{ storeId: string; ok: boolean; error?: string }>; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }
  const service = createSupabaseService()
  const results: Array<{ storeId: string; ok: boolean; error?: string }> = []
  for (const id of storeIds) {
    const r = await dispatchManualPatrol(supa, service, id)
    results.push({ storeId: id, ...r })
  }
  revalidatePath('/security')
  return { ok: true, results }
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

/**
 * 巡回設定（店舗別）— 固定時刻モード。1日最大4回の巡回時刻を指定する。
 * 曜日指定は撤去し全曜日実施（active_days は全曜日固定）。
 */
export interface SecurityPatrolInput {
  storeId: string
  patrolTimes: string[] // "HH:MM" 最大4件（空は無視）
  notifyEmails: string[]
  enabled: boolean
}

const HHMM_24 = /^([01]\d|2[0-3]):[0-5]\d$/

/** 入力を security_settings 行に写像（固定モード・全曜日）。 */
function toSecurityRow(input: SecurityPatrolInput) {
  return {
    store_id: input.storeId,
    schedule_mode: 'fixed' as const,
    patrol_times: input.patrolTimes.filter((t) => HHMM_24.test(t)).slice(0, 4),
    active_days: [0, 1, 2, 3, 4, 5, 6],
    notify_emails: input.notifyEmails,
    enabled: input.enabled,
  }
}

function validateTimes(input: SecurityPatrolInput): string | null {
  const nonEmpty = input.patrolTimes.filter((t) => t.trim() !== '')
  if (nonEmpty.some((t) => !HHMM_24.test(t))) return '時刻は HH:MM 形式で入力してください'
  return null
}

/** 1店舗の巡回設定を保存。 */
export async function upsertSecurityPatrolTimes(
  input: SecurityPatrolInput,
): Promise<{ ok: boolean; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }
  const verr = validateTimes(input)
  if (verr) return { ok: false, error: verr }

  const { error } = await supa.from('security_settings').upsert(toSecurityRow(input), { onConflict: 'store_id' })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/security/settings')
  revalidatePath('/security')
  return { ok: true }
}

/** 複数店舗の巡回設定を一括保存。 */
export async function bulkUpsertSecurityPatrolTimes(
  inputs: SecurityPatrolInput[],
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return { ok: false, error: 'unauthorized' }
  for (const i of inputs) {
    const verr = validateTimes(i)
    if (verr) return { ok: false, error: verr }
  }

  const { error } = await supa.from('security_settings').upsert(inputs.map(toSecurityRow), { onConflict: 'store_id' })
  if (error) return { ok: false, error: error.message }
  revalidatePath('/security/settings')
  revalidatePath('/security')
  return { ok: true, count: inputs.length }
}
