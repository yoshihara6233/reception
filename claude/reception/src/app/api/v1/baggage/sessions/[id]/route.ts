/**
 * 手荷物検査 詳細（T6）
 *
 * GET /api/v1/baggage/sessions/:id
 *   セッション＋当日イベント＋クリップ（署名URL）＋従業員マスタ顔を返す。
 *   顔・映像の閲覧は監査ログに記録する（D8・機微データ）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'
import { isFullAdmin } from '@/lib/acl'

const SIGN_TTL = 300 // 5分

async function sign(supabase: ReturnType<typeof createAdminClient>, bucket: string, path: string | null) {
  if (!path) return null
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, SIGN_TTL)
  return data?.signedUrl ?? null
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const supabase = createAdminClient()

  interface SessionRow {
    id: string; store_id: string; tenant_id: string; inspection_date: string
    person_kind: string; visitor_name: string | null; visitor_company: string | null
    card_photo_path: string | null; entry_at: string | null; entry_face_path: string | null
    exit_at: string | null; exit_face_path: string | null
    inspection_started_at: string | null; inspection_ended_at: string | null
    status: string; auth_skipped: boolean; confirmed_at: string | null; confirmed_by: string | null
    employee_id: string | null
  }

  const { data: s } = await supabase
    .from('inspection_sessions')
    .select(
      'id, store_id, tenant_id, inspection_date, person_kind, visitor_name, visitor_company, ' +
      'card_photo_path, entry_at, entry_face_path, exit_at, exit_face_path, ' +
      'inspection_started_at, inspection_ended_at, status, auth_skipped, confirmed_at, confirmed_by, employee_id',
    )
    .eq('id', id)
    .maybeSingle<SessionRow>()

  if (!s || s.tenant_id !== ctx.tenant_id) {
    return NextResponse.json({ error: 'セッションが見つかりません' }, { status: 404 })
  }
  if (!isFullAdmin(ctx.role) && !ctx.store_ids.includes(s.store_id)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  // 従業員マスタ（顔）— 埋め込みを避けて別クエリ
  const emp = s.employee_id
    ? (await supabase
        .from('store_employees')
        .select('name, employee_code, face_photo_path')
        .eq('id', s.employee_id)
        .maybeSingle<{ name: string; employee_code: string; face_photo_path: string | null }>()).data
    : null

  const [events, clips] = await Promise.all([
    supabase.from('inspection_session_events')
      .select('id, kind, occurred_at, auth_skipped')
      .eq('session_id', id)
      .order('occurred_at', { ascending: true }),
    supabase.from('inspection_clips')
      .select('camera_id, storage_path, duration_sec, clock_offset_sec, upload_status')
      .eq('session_id', id),
  ])

  const clipsSigned = await Promise.all(
    (clips.data ?? []).map(async (c) => ({
      cameraId: c.camera_id,
      durationSec: c.duration_sec,
      clockOffsetSec: c.clock_offset_sec,
      uploadStatus: c.upload_status,
      url: await sign(supabase, 'baggage-clips', c.storage_path),
    })),
  )

  const detail = {
    id: s.id,
    inspectionDate: s.inspection_date,
    personKind: s.person_kind,
    visitorName: s.visitor_name,
    visitorCompany: s.visitor_company,
    status: s.status,
    authSkipped: s.auth_skipped,
    confirmedAt: s.confirmed_at,
    entryAt: s.entry_at,
    exitAt: s.exit_at,
    inspectionStartedAt: s.inspection_started_at,
    inspectionEndedAt: s.inspection_ended_at,
    employee: emp ? { name: emp.name, employeeCode: emp.employee_code } : null,
    faces: {
      entry: await sign(supabase, 'baggage-photos', s.entry_face_path),
      exit: await sign(supabase, 'baggage-photos', s.exit_face_path),
      card: await sign(supabase, 'baggage-photos', s.card_photo_path),
      master: await sign(supabase, 'baggage-photos', emp?.face_photo_path ?? null),
    },
    events: events.data ?? [],
    clips: clipsSigned,
  }

  // 閲覧監査ログ（誰がいつ顔・映像を見たか）
  await supabase.from('audit_logs').insert({
    tenant_id: s.tenant_id,
    admin_user_id: ctx.id,
    action: 'baggage.inspection.view',
    resource_type: 'inspection_session',
    resource_id: id,
    details: { store_id: s.store_id },
  })

  return NextResponse.json({ session: detail })
}
