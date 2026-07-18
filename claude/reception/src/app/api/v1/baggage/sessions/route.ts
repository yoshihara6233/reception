/**
 * 手荷物検査セッションの記録（T4 統合）
 *
 * POST /api/v1/baggage/sessions
 *   iPad キオスクが入室/退室/途中入退室を記録する。
 *   body: {
 *     storeId, action: 'entry'|'exit'|'temp_exit'|'temp_return',
 *     personKind: 'staff'|'visitor', employeeId?, visitorName?, visitorCompany?,
 *     cardPhotoPath?, facePath?, authSkipped?,
 *     inspectionStartedAt?, inspectionEndedAt?, status?  // exit時
 *   }
 *
 * 退室(exit)では検査窓からカメラ毎の clip_jobs を生成する（全退出系＝completed/
 * interrupted/auth_skipped で生成）。書き込みは service role（RLSバイパス）。
 *
 * NOTE: キオスク端末認証（デバイス紐付け）は後続。現状は storeId から tenant を
 *       解決し、baggage_option.enabled の店舗のみ受理する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildClipJobs } from '@/lib/baggage/clip-jobs'
import { isTempEvent, type FlowAction, type PersonKind } from '@/lib/baggage/inspection-flow'
import { listSessions } from './route-list'

/** GET /api/v1/baggage/sessions — 管理: 履歴一覧（店舗スコープ・フィルタ）。 */
export function GET(req: NextRequest) {
  return listSessions(req)
}

function todayInTz(): string {
  return new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD
}

interface Body {
  storeId?: string
  action?: FlowAction
  personKind?: PersonKind
  employeeId?: string | null
  visitorName?: string | null
  visitorCompany?: string | null
  cardPhotoPath?: string | null
  facePath?: string | null
  authSkipped?: boolean
  inspectionStartedAt?: string
  inspectionEndedAt?: string
  status?: 'completed' | 'interrupted'
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null
  if (!body?.storeId || !body.action || !body.personKind) {
    return NextResponse.json({ error: 'storeId, action, personKind are required' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: store } = await supabase
    .from('stores')
    .select('id, tenant_id, settings')
    .eq('id', body.storeId)
    .maybeSingle()

  if (!store) return NextResponse.json({ error: 'store not found' }, { status: 404 })

  const opt = ((store.settings as Record<string, unknown>)?.baggage_option ?? {}) as Record<string, unknown>
  if (opt.enabled !== true) {
    return NextResponse.json({ error: 'baggage option not enabled' }, { status: 403 })
  }

  const tenantId = store.tenant_id
  const now = new Date()
  const nowIso = now.toISOString()
  const common = {
    tenant_id: tenantId,
    store_id: body.storeId,
    person_kind: body.personKind,
    employee_id: body.employeeId ?? null,
    auth_skipped: body.authSkipped ?? false,
  }

  // ── 入室 ──────────────────────────────────────────────────────────────────
  if (body.action === 'entry') {
    const { data, error } = await supabase
      .from('inspection_sessions')
      .insert({
        ...common,
        inspection_date: todayInTz(),
        visitor_name: body.visitorName ?? null,
        visitor_company: body.visitorCompany ?? null,
        card_photo_path: body.cardPhotoPath ?? null,
        entry_at: nowIso,
        entry_face_path: body.facePath ?? null,
        status: 'entered',
      })
      .select('id')
      .single()
    if (error || !data) return NextResponse.json({ error: 'failed to create session' }, { status: 500 })
    return NextResponse.json({ sessionId: data.id, status: 'entered' }, { status: 201 })
  }

  // ── 途中退室 / 途中入室（顔認証のみ・検査/クリップなし・D17） ─────────────
  if (isTempEvent(body.action)) {
    // 未退出の最新 entry に紐付け（無ければ孤立イベント）
    const { data: open } = await supabase
      .from('inspection_sessions')
      .select('id')
      .eq('store_id', body.storeId)
      .eq('person_kind', body.personKind)
      .is('exit_at', null)
      .order('entry_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const { error } = await supabase.from('inspection_session_events').insert({
      ...common,
      session_id: open?.id ?? null,
      kind: body.action,
      occurred_at: nowIso,
      face_path: body.facePath ?? null,
    })
    if (error) return NextResponse.json({ error: 'failed to record event' }, { status: 500 })
    return NextResponse.json({ status: 'recorded', linkedSession: open?.id ?? null }, { status: 201 })
  }

  // ── 退室（検査・クリップ生成） ──────────────────────────────────────────────
  // action === 'exit'
  const { data: open } = await supabase
    .from('inspection_sessions')
    .select('id')
    .eq('store_id', body.storeId)
    .eq('person_kind', body.personKind)
    .is('exit_at', null)
    .order('entry_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const startedAt = body.inspectionStartedAt ?? nowIso
  const endedAt = body.inspectionEndedAt ?? nowIso
  const exitStatus = body.status ?? 'completed'

  let sessionId: string
  if (open) {
    await supabase
      .from('inspection_sessions')
      .update({
        exit_at: nowIso,
        exit_face_path: body.facePath ?? null,
        inspection_started_at: startedAt,
        inspection_ended_at: endedAt,
        status: exitStatus,
        auth_skipped: common.auth_skipped,
        updated_at: nowIso,
      })
      .eq('id', open.id)
    sessionId = open.id
  } else {
    // 入室記録なし退出（アンマッチ）でも検査は成立させる
    const { data, error } = await supabase
      .from('inspection_sessions')
      .insert({
        ...common,
        inspection_date: todayInTz(),
        exit_at: nowIso,
        exit_face_path: body.facePath ?? null,
        inspection_started_at: startedAt,
        inspection_ended_at: endedAt,
        status: 'unmatched_entry',
      })
      .select('id')
      .single()
    if (error || !data) return NextResponse.json({ error: 'failed to create exit session' }, { status: 500 })
    sessionId = data.id
  }

  // クリップジョブ生成（全退出系。カメラ2台分）
  const cameraIds = Array.isArray(opt.camera_ids) ? (opt.camera_ids as string[]).filter(Boolean) : []
  if (cameraIds.length > 0) {
    const jobs = buildClipJobs(
      { inspectionStartedAt: new Date(startedAt), inspectionEndedAt: new Date(endedAt), cameraIds },
      {
        preBufferSec: Number(opt.pre_buffer_sec) || 15,
        postBufferSec: Number(opt.post_buffer_sec) || 15,
        notBeforeMin: Number(opt.not_before_min) || 5,
        nvrRetentionDays: Number(opt.nvr_retention_days) || 14,
      },
    )
    await supabase.from('inspection_clip_jobs').insert(
      jobs.map((j) => ({
        tenant_id: tenantId,
        store_id: body.storeId,
        session_id: sessionId,
        camera_id: j.cameraId,
        window_from: j.windowFrom.toISOString(),
        window_to: j.windowTo.toISOString(),
        not_before: j.notBefore.toISOString(),
        deadline_at: j.deadlineAt.toISOString(),
        status: 'pending',
      })),
    )
  }

  return NextResponse.json({ sessionId, status: exitStatus, clipJobs: cameraIds.length }, { status: 201 })
}
