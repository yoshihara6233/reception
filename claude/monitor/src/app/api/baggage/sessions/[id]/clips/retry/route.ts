/**
 * POST /api/baggage/sessions/[id]/clips/retry — 検査クリップの手動再取得
 *
 * 「処理中」のまま自動リトライが失敗し続ける（NVR録画の一時未確定・回線不調等）
 * 検査を、店長/管理者が手動で今すぐ再取得できるようにする。BCP の手動再取得と同趣旨。
 *
 * 動作:
 *   1. 未完了ジョブ（pending/running/failed）を pending へ戻し、not_before=now・
 *      retry_count=0 にして即再試行。deadline を過ぎていれば当日+保持日数で延長。
 *   2. 失敗クリップ行（upload_status='failed'）を削除 → バッジが「取得失敗」から
 *      「処理中」に戻り、成功時に done へ進める。
 *   3. ジョブが1つも無い（生成前 or 掃除済み）場合は inspection_settings.camera_ids と
 *      テナント設定から作り直す。
 *
 * 認可: セッションが RLS で見えるユーザーのみ（詳細画面と同じ規律）。実書き込みは
 * service（ジョブ表はエッジ用キューで通常ユーザーには write ポリシーが無いため）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { loadTenantSettings } from '@/lib/baggage/tenant-settings'
import { buildClipJobs } from '@intereco/shared/baggage'

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // RLS 越し可視性チェック（見えない検査は 404）。
  const { data: sess } = await supa
    .from('inspection_sessions')
    .select('id, store_id, inspection_started_at, inspection_ended_at')
    .eq('id', id)
    .maybeSingle()
  if (!sess) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (!sess.inspection_started_at || !sess.inspection_ended_at) {
    return NextResponse.json({ error: 'no_inspection_window' }, { status: 400 })
  }

  const svc = createSupabaseService()
  const nowIso = new Date().toISOString()

  // 店舗→テナントを解決（deadline 延長基準・ジョブ再生成の tenant_id に使う）。
  const { data: store } = await svc.from('stores').select('tenant_id').eq('id', sess.store_id).maybeSingle()
  const tenantId = (store as { tenant_id?: string } | null)?.tenant_id
  if (!tenantId) return NextResponse.json({ error: 'tenant_not_resolved' }, { status: 500 })
  const tenant = await loadTenantSettings(svc, tenantId).catch(() => null)
  const retentionDays = tenant?.nvrRetentionDays ?? 14

  // 失敗クリップ行を消す（成功で done に進めるように・バッジも処理中へ戻す）。
  await svc.from('inspection_clips')
    .delete()
    .eq('session_id', id)
    .eq('upload_status', 'failed')

  // 既存の未完了ジョブを取得。
  const { data: jobs } = await svc
    .from('inspection_clip_jobs')
    .select('id, status, deadline_at')
    .eq('session_id', id)
  const rows = (jobs ?? []) as { id: string; status: string; deadline_at: string }[]
  const retryable = rows.filter((j) => j.status !== 'done')

  const extendedDeadlineMs = Date.now() + Math.max(1, retentionDays - 2) * 24 * 60 * 60 * 1000
  const extendedDeadlineIso = new Date(extendedDeadlineMs).toISOString()

  let requeued = 0
  for (const j of retryable) {
    const deadline = new Date(j.deadline_at).getTime() < Date.now() ? extendedDeadlineIso : j.deadline_at
    const { error } = await svc.from('inspection_clip_jobs')
      .update({ status: 'pending', not_before: nowIso, retry_count: 0, deadline_at: deadline, updated_at: nowIso })
      .eq('id', j.id)
    if (!error) requeued++
  }

  // ジョブが1つも無い場合は設定から作り直す（生成前/掃除済み）。
  let created = 0
  if (rows.length === 0) {
    const { data: settingRow } = await svc
      .from('inspection_settings')
      .select('camera_ids')
      .eq('store_id', sess.store_id)
      .maybeSingle()
    const cameraIds = (settingRow?.camera_ids ?? []) as string[]
    if (cameraIds.length === 0) return NextResponse.json({ error: 'no_cameras_configured' }, { status: 400 })

    const specs = buildClipJobs(
      {
        inspectionStartedAt: new Date(sess.inspection_started_at),
        inspectionEndedAt: new Date(sess.inspection_ended_at),
        cameraIds,
      },
      { nvrRetentionDays: retentionDays },
    )
    const insertRows = specs.map((s) => ({
      tenant_id: tenantId,
      store_id: sess.store_id,
      session_id: id,
      camera_id: s.cameraId,
      window_from: s.windowFrom.toISOString(),
      window_to: s.windowTo.toISOString(),
      not_before: nowIso,             // 手動再取得は即実行（未確定待ちはスキップ）
      deadline_at: s.deadlineAt.toISOString(),
      status: 'pending',
    }))
    const { error, count } = await svc.from('inspection_clip_jobs').insert(insertRows, { count: 'exact' })
    if (error) return NextResponse.json({ error: `job_create_failed: ${error.message}` }, { status: 500 })
    created = count ?? insertRows.length
  }

  return NextResponse.json({ ok: true, requeued, created })
}
