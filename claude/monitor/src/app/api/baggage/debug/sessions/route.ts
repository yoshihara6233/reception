/**
 * GET /api/baggage/debug/sessions?store=<uuid> — 診断用（生の employee_id・登録状況）
 *
 * 「顔認証できたのに従業員マスタ未登録」の切り分け用。管理者/店長が開き、
 * 従業員の登録有無と直近セッションの employee_id をそのまま確認する。
 * 秘密情報は含めない（顔パスの有無のみ）。requireBaggageAccess で認可。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireBaggageAccess } from '@/lib/baggage/kiosk-guard'

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('store')
  const guard = await requireBaggageAccess(storeId)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const { svc, store } = guard

  const { data: emps } = await svc
    .from('employees')
    .select('id, name, employee_code, status, rekognition_face_id, consent_at, consent_version')
    .eq('store_id', store.id)
    .order('created_at', { ascending: true })

  const { data: sessions } = await svc
    .from('inspection_sessions')
    .select('id, person_kind, status, employee_id, auth_skipped, entry_at, exit_at, entry_face_path, exit_face_path, card_photo_path, consent_at, consent_version, created_at')
    .eq('store_id', store.id)
    .order('created_at', { ascending: false })
    .limit(15)

  return NextResponse.json({
    store: store.name,
    employees: (emps ?? []).map((e) => ({
      name: e.name,
      code: e.employee_code,
      status: e.status,
      faceRegistered: !!e.rekognition_face_id,
      faceId: e.rekognition_face_id ? `${String(e.rekognition_face_id).slice(0, 8)}…` : null,
      consentAt: e.consent_at,
      consentVersion: e.consent_version,
      id: e.id,
    })),
    recentSessions: (sessions ?? []).map((s) => ({
      id: String(s.id).slice(0, 8),
      kind: s.person_kind,
      status: s.status,
      employeeId: s.employee_id ? `${String(s.employee_id).slice(0, 8)}…` : null,
      authSkipped: s.auth_skipped,
      hasEntryFace: !!s.entry_face_path,
      hasExitFace: !!s.exit_face_path,
      hasCard: !!s.card_photo_path,
      consentVersion: s.consent_version,
      entryAt: s.entry_at,
      exitAt: s.exit_at,
    })),
  })
}
