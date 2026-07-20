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

  // テナント共通設定（同意文言・あいさつ・退室文言）。migration 未適用でも落ちないよう
  // select('*') で取得し、列の有無・値をそのまま見る。
  const { data: tenantRow, error: tenantErr } = await svc
    .from('baggage_tenant_settings')
    .select('*')
    .eq('tenant_id', guard.store.tenantId)
    .maybeSingle()

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

  const t = (tenantRow ?? {}) as Record<string, unknown>
  return NextResponse.json({
    store: store.name,
    tenantSettings: {
      rowExists: !!tenantRow,
      // migration 未適用なら列自体が存在しない → undefined になる（適用済みなら null/値）。
      consentTextSet: typeof t.consent_text === 'string' && t.consent_text.trim().length > 0,
      consentTextLength: typeof t.consent_text === 'string' ? t.consent_text.length : null,
      consentVersion: t.consent_version ?? null,
      entryGreetingSet: typeof t.entry_greeting_text === 'string' && t.entry_greeting_text.trim().length > 0,
      exitMessageSet: typeof t.exit_message_text === 'string' && t.exit_message_text.trim().length > 0,
      consentColumnPresent: 'consent_text' in t,
      greetingColumnPresent: 'entry_greeting_text' in t,
      error: tenantErr?.message ?? null,
    },
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
