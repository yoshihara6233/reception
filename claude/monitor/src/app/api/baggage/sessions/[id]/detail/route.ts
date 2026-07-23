/**
 * GET /api/baggage/sessions/[id]/detail — 検査詳細（JSON・master-detail 右ペイン用）
 *
 * 標準の /baggage/[id]（サーバpage）と同じ RLS/監査規律で、右ペインが
 * 行選択のたびに取得する軽量JSONを返す。写真・クリップの実体は従来どおり
 * 署名URLプロキシ（/api/baggage/sessions/[id]/photo・/api/baggage/clips/[id]）越し。
 * 閲覧は footage_access_log（baggage_view・5分dedup）に記録（G3）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { recordFootageAccess } from '@/lib/audit/footage-access'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // RLS 越し: 見えないセッションは 404
  const { data: sess } = await supa
    .from('inspection_sessions')
    .select(`id, store_id, person_kind, visitor_name, visitor_company, entry_at, exit_at,
      entry_face_path, exit_face_path, card_photo_path, inspection_started_at, inspection_ended_at,
      status, auth_skipped, confirmed_at, inspection_date, consent_at, consent_version, employee_id,
      stores ( name )`)
    .eq('id', id)
    .maybeSingle()
  if (!sess) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const store = (Array.isArray(sess.stores) ? sess.stores[0] : sess.stores) as { name: string } | null

  // employees は reception 世代のレガシーRLS（JWT tenant 依存）で JOIN が空になるため、
  // セッションの可視性を RLS で確認した上で、従業員名/顔は service 経由で解決する。
  let emp: { name: string; face_photo_path: string | null } | null = null
  if (sess.person_kind === 'staff' && sess.employee_id) {
    const { data } = await createSupabaseService()
      .from('employees').select('name, face_photo_path').eq('id', sess.employee_id).maybeSingle()
    emp = data as { name: string; face_photo_path: string | null } | null
  }

  const { data: clipRows } = await supa
    .from('inspection_clips')
    .select('id, camera_id, duration_sec, clock_offset_sec, upload_status, recorder_cameras ( name )')
    .eq('session_id', id)
    .order('created_at', { ascending: true })
  const clips = ((clipRows ?? []) as unknown[]).map((c) => {
    const row = c as { id: string; duration_sec: number | null; clock_offset_sec: number | null; upload_status: string; recorder_cameras: unknown }
    const cam = Array.isArray(row.recorder_cameras) ? row.recorder_cameras[0] : row.recorder_cameras
    return { ...row, cameraName: (cam as { name?: string } | null)?.name ?? 'カメラ' }
  })

  // 切り出しジョブの状況（service。ジョブ表は edge 用キューでユーザーRLSでは見えない）。
  //  - clipsPending: 実行中(pending/running)が有る → 確認済みを解禁しない
  //  - clipTotal / clipDone: 「再取得」ボタンの表示判定（未完了なら出す）
  const jobsSvc = createSupabaseService()
  const { data: jobRows } = await jobsSvc
    .from('inspection_clip_jobs')
    .select('status')
    .eq('session_id', id)
  const jobStatuses = ((jobRows ?? []) as { status: string }[]).map((j) => j.status)
  const clipsPending = jobStatuses.some((s) => s === 'pending' || s === 'running')
  const clipTotal = jobStatuses.length
  const clipDone = jobStatuses.filter((s) => s === 'done').length

  // G3: 閲覧を記録（best-effort・5分dedup）
  await recordFootageAccess({
    actorUserId: user.id, storeId: sess.store_id, accessType: 'baggage_view', resourceId: id,
  })

  const playableClips = clips
    .filter((c) => c.upload_status === 'done')
    .map((c) => ({
      id: c.id,
      cameraName: c.cameraName,
      src: `/api/baggage/clips/${c.id}`,
      durationSec: c.duration_sec != null ? Number(c.duration_sec) : null,
    }))

  const windowSec = sess.inspection_started_at && sess.inspection_ended_at
    ? Math.max(0, (new Date(sess.inspection_ended_at).getTime() - new Date(sess.inspection_started_at).getTime()) / 1000)
    : null
  const maxOffset = clips
    .map((c) => (c.clock_offset_sec == null ? null : Number(c.clock_offset_sec)))
    .filter((v): v is number => v !== null)
    .sort((a, b) => Math.abs(b) - Math.abs(a))[0] ?? null

  return NextResponse.json({
    id: sess.id,
    personKind: sess.person_kind as 'staff' | 'visitor',
    person: sess.person_kind === 'staff' ? (emp?.name ?? '（未特定）') : (sess.visitor_name ?? '（未特定）'),
    visitorCompany: sess.visitor_company ?? null,
    entryAt: sess.entry_at,
    exitAt: sess.exit_at,
    hasEntryFace: !!sess.entry_face_path,
    hasExitFace: !!sess.exit_face_path,
    hasCardPhoto: !!sess.card_photo_path,
    employeeName: emp?.name ?? null,
    hasEmployeeFace: !!emp?.face_photo_path,
    inspectionStartedAt: sess.inspection_started_at,
    inspectionEndedAt: sess.inspection_ended_at,
    status: sess.status as string,
    authSkipped: !!sess.auth_skipped,
    confirmedAt: sess.confirmed_at,
    inspectionDate: sess.inspection_date,
    consentAt: sess.consent_at,
    consentVersion: sess.consent_version,
    storeName: store?.name ?? null,
    windowSec,
    maxOffset,
    clips: playableClips,
    clipsPending,
    clipTotal,
    clipDone,
  })
}
