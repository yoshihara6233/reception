/**
 * POST /api/baggage/kiosk/sessions — キオスクのセッション記録（M3）
 *
 * ワイヤーフレーム v3（D17）の4動作を1エンドポイントで受ける:
 *   - entry:       セッション作成（entered）。visitor は顔を当日コレクションへ登録
 *                  （ExternalImageId = セッションID — 退出時の照合で本人セッションに直結）
 *   - temp_exit / temp_return: 未退出セッションへ軽量イベント紐付け（検査・クリップなし）
 *   - exit:        検査完了/中断時に1回だけ呼ぶ。未退出セッションを閉じ
 *                  （無ければ unmatched_entry で新規作成）、検査窓から
 *                  カメラ毎の inspection_clip_jobs を生成（全退出系で生成）
 *
 * 書き込みは service role（RLS はポリシー無し=deny）。呼び出しは requireKioskStore
 * （ログイン済み admin_users ＋店舗スコープ＋enabled 店舗のみ）を通過したものに限る。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireKioskStore } from '@/lib/baggage/kiosk-guard'
import { buildClipJobs } from '@/lib/baggage/clip-jobs'
import { isTempEvent } from '@/lib/baggage/inspection-flow'
import { withTimeout, jstYmd } from '@/lib/baggage/face-auth'
import { jstDateStr } from '@/lib/baggage/unmatch'
import { visitorDailyCollectionId, indexFaceInCollection } from '@/lib/aws/rekognition'
import { FACE_SEARCH_TIMEOUT_SEC } from '@/lib/baggage/inspection-flow'

const Body = z.object({
  storeId: z.string().uuid(),
  action: z.enum(['entry', 'temp_exit', 'temp_return', 'exit']),
  personKind: z.enum(['staff', 'visitor']),
  employeeId: z.string().uuid().nullish(),        // staff: face-auth の一致結果
  entrySessionId: z.string().uuid().nullish(),    // visitor exit: face-auth の一致結果
  facePath: z.string().nullish(),
  authSkipped: z.boolean().optional(),
  // exit 時のみ（検査窓・確定状態）
  inspectionStartedAt: z.string().datetime({ offset: true }).optional(),
  inspectionEndedAt: z.string().datetime({ offset: true }).optional(),
  status: z.enum(['completed', 'interrupted']).optional(),
})

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const body = parsed.data

  const guard = await requireKioskStore(body.storeId)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const { svc, store, settings } = guard

  // facePath は face-auth が生成した自店舗プレフィックスのみ受理
  // （他店舗パスの持ち込み＝写真プロキシ経由の越権閲覧・visitor登録の混入を防ぐ）
  if (body.facePath && !body.facePath.startsWith(`${store.id}/`)) {
    return NextResponse.json({ error: 'invalid_face_path' }, { status: 400 })
  }
  // employeeId も自店舗の従業員のみ受理（face-auth の一致結果以外の任意UUIDを弾く）
  if (body.employeeId) {
    const { data: emp } = await svc
      .from('employees')
      .select('id')
      .eq('id', body.employeeId)
      .eq('store_id', store.id)
      .maybeSingle()
    if (!emp) return NextResponse.json({ error: 'invalid_employee' }, { status: 400 })
  }

  const now = new Date()
  const nowIso = now.toISOString()
  const common = {
    tenant_id: store.tenantId,
    store_id: store.id,
    person_kind: body.personKind,
    employee_id: body.employeeId ?? null,
    auth_skipped: body.authSkipped ?? false,
  }

  // ── 入室 ──────────────────────────────────────────────────────────────────
  if (body.action === 'entry') {
    const { data, error } = await svc
      .from('inspection_sessions')
      .insert({
        ...common,
        inspection_date: jstDateStr(now),
        entry_at: nowIso,
        entry_face_path: body.facePath ?? null,
        status: 'entered',
      })
      .select('id')
      .single()
    if (error || !data) return NextResponse.json({ error: 'session_create_failed' }, { status: 500 })

    // 来訪者: 顔を当日コレクションへ登録（ExternalImageId = セッションID）。
    // 登録失敗は退出時の照合が効かなくなるだけ（authSkipped 動線で成立）— 非致命。
    let faceIndexed = false
    if (body.personKind === 'visitor' && body.facePath) {
      const { data: blob } = await svc.storage.from('baggage-photos').download(body.facePath)
      if (blob) {
        const buf = Buffer.from(await blob.arrayBuffer())
        const r = await withTimeout(
          indexFaceInCollection(visitorDailyCollectionId(store.id, jstYmd(now)), data.id, buf),
          FACE_SEARCH_TIMEOUT_SEC * 1000,
        )
        faceIndexed = r.ok
      }
    }
    return NextResponse.json({ sessionId: data.id, status: 'entered', faceIndexed }, { status: 201 })
  }

  // ── 途中退室 / 途中入室（顔認証のみ・検査/クリップなし・D17） ─────────────
  if (isTempEvent(body.action)) {
    const open = await findOpenSession(svc, store.id, body.personKind, body.employeeId ?? null, body.entrySessionId ?? null)
    const { error } = await svc.from('inspection_session_events').insert({
      ...common,
      session_id: open?.id ?? null,
      kind: body.action,
      occurred_at: nowIso,
      face_path: body.facePath ?? null,
    })
    if (error) return NextResponse.json({ error: 'event_create_failed' }, { status: 500 })
    return NextResponse.json({ status: 'recorded', linkedSession: open?.id ?? null }, { status: 201 })
  }

  // ── 退室（検査窓確定・クリップジョブ生成） ──────────────────────────────────
  const startedAt = body.inspectionStartedAt ?? nowIso
  const endedAt = body.inspectionEndedAt ?? nowIso
  const exitStatus = body.status ?? 'completed'

  const open = await findOpenSession(svc, store.id, body.personKind, body.employeeId ?? null, body.entrySessionId ?? null)

  let sessionId: string
  if (open) {
    // 冪等クローズ: exit_at が未設定の時だけ更新（二重送信・並行リクエストの後着は 0 行）。
    const { data: closed, error } = await svc
      .from('inspection_sessions')
      .update({
        exit_at: nowIso,
        exit_face_path: body.facePath ?? null,
        employee_id: body.employeeId ?? open.employee_id,
        inspection_started_at: startedAt,
        inspection_ended_at: endedAt,
        status: exitStatus,
        auth_skipped: common.auth_skipped,
        updated_at: nowIso,
      })
      .eq('id', open.id)
      .is('exit_at', null)
      .select('id')
      .maybeSingle()
    if (error) return NextResponse.json({ error: 'session_update_failed' }, { status: 500 })
    if (!closed) {
      // 先着が既にクローズ済み（重複送信）。ジョブを増やさず成功で返す。
      return NextResponse.json({ sessionId: open.id, status: exitStatus, clipJobs: 0, duplicate: true })
    }
    sessionId = open.id
  } else {
    // 二重送信（同一操作のリトライ）のみを重複とみなす短い窓。顔認証できない退室は
    // 原則アンマッチとして記録するため、別人の連続退室を取りこぼさないよう窓を短くする。
    const { data: justClosed } = await svc
      .from('inspection_sessions')
      .select('id, status')
      .eq('store_id', store.id)
      .eq('person_kind', body.personKind)
      .gte('exit_at', new Date(now.getTime() - 5_000).toISOString())
      .order('exit_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (justClosed) {
      return NextResponse.json({ sessionId: justClosed.id, status: justClosed.status, clipJobs: 0, duplicate: true })
    }
    // 入室記録なし退出（アンマッチ）でも検査は成立させる
    const { data, error } = await svc
      .from('inspection_sessions')
      .insert({
        ...common,
        inspection_date: jstDateStr(now),
        exit_at: nowIso,
        exit_face_path: body.facePath ?? null,
        inspection_started_at: startedAt,
        inspection_ended_at: endedAt,
        status: 'unmatched_entry',
      })
      .select('id')
      .single()
    if (error || !data) return NextResponse.json({ error: 'session_create_failed' }, { status: 500 })
    sessionId = data.id
  }

  // クリップジョブ生成（全退出系＝completed / interrupted。カメラ未設定なら 0 件）
  let clipJobsCreated = 0
  if (settings.cameraIds.length > 0) {
    const jobs = buildClipJobs(
      { inspectionStartedAt: new Date(startedAt), inspectionEndedAt: new Date(endedAt), cameraIds: settings.cameraIds },
      { nvrRetentionDays: settings.nvrRetentionDays },
    )
    const { error } = await svc.from('inspection_clip_jobs').insert(
      jobs.map((j) => ({
        tenant_id: store.tenantId,
        store_id: store.id,
        session_id: sessionId,
        camera_id: j.cameraId,
        window_from: j.windowFrom.toISOString(),
        window_to: j.windowTo.toISOString(),
        not_before: j.notBefore.toISOString(),
        deadline_at: j.deadlineAt.toISOString(),
        status: 'pending',
      })),
    )
    if (error) console.error('[baggage] clip job insert failed:', error.message)
    else clipJobsCreated = jobs.length
  }

  return NextResponse.json(
    { sessionId, status: open ? exitStatus : 'unmatched_entry', clipJobs: clipJobsCreated },
    { status: 201 },
  )
}

/**
 * 「未退出の入室セッション」を顔認証の結果に基づいてのみ解決する。
 *
 * 顔認証で本人が特定できた時だけ紐づける:
 *   - 来訪者: entrySessionId（当日コレクション照合で得た本人の入室セッションID）
 *   - 従業員: employeeId（常設コレクション照合で得た本人）→ その従業員の未退出セッション
 * 顔認証できていない（entrySessionId も employeeId も無い）場合は、店舗×区分の最新を
 * 推測で紐づけない → 呼び出し側でアンマッチ（入室記録なし）として記録する。
 * （旧実装は未特定時に最新の入室へ機械的に紐づけていたが、別人を同一視する恐れがあり廃止）
 */
async function findOpenSession(
  svc: ReturnType<typeof import('@/lib/supabase/server').createSupabaseService>,
  storeId: string,
  personKind: 'staff' | 'visitor',
  employeeId: string | null,
  entrySessionId: string | null,
): Promise<{ id: string; employee_id: string | null } | null> {
  // 来訪者: 顔照合で本人の入室セッションが取れた時のみ。
  if (entrySessionId) {
    const { data } = await svc
      .from('inspection_sessions')
      .select('id, employee_id')
      .eq('id', entrySessionId)
      .eq('store_id', storeId)
      .is('exit_at', null)
      .maybeSingle()
    return data ?? null
  }
  // 従業員: 顔照合で本人(employee_id)が特定できた時のみ、その従業員の未退出セッションに。
  if (employeeId) {
    const { data } = await svc
      .from('inspection_sessions')
      .select('id, employee_id')
      .eq('store_id', storeId)
      .eq('person_kind', personKind)
      .eq('employee_id', employeeId)
      .is('exit_at', null)
      .order('entry_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return data ?? null
  }
  // 顔認証で本人特定できていない → 推測で紐づけない（アンマッチにする）。
  return null
}
