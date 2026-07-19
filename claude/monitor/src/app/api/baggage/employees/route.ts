/**
 * POST /api/baggage/employees — 従業員の新規登録（M4・顔認証世代）
 *
 * 既存 employees テーブル（QR世代）を拡張利用。qr_code は NOT NULL のため
 * ランダム値を充当（QR運用とは独立）。顔登録は別エンドポイント（/[id]/face）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBaggageAccess } from '@/lib/baggage/kiosk-guard'
import { recordAudit } from '@/lib/admin/audit'

const Body = z.object({
  storeId: z.string().uuid(),
  name: z.string().min(1).max(60),
  employeeCode: z.string().max(30).nullish(),
})

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const body = parsed.data

  const guard = await requireBaggageAccess(body.storeId)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const { svc, store } = guard

  const { data, error } = await svc
    .from('employees')
    .insert({
      tenant_id: store.tenantId,
      store_id: store.id,
      name: body.name.trim(),
      employee_code: body.employeeCode?.trim() || null,
      qr_code: crypto.randomUUID(),   // レガシー NOT NULL 列（顔認証世代では未使用）
      status: 'active',
    })
    .select('id')
    .single()
  if (error || !data) {
    const dup = error?.message.includes('idx_employees_store_code')
    return NextResponse.json({ error: dup ? 'employee_code_duplicate' : (error?.message ?? 'insert_failed') },
      { status: dup ? 409 : 500 })
  }

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id, action: 'baggage.employee.create', targetType: 'employee',
    targetId: data.id, storeId: store.id, changes: { name: body.name },
  })
  return NextResponse.json({ id: data.id }, { status: 201 })
}
