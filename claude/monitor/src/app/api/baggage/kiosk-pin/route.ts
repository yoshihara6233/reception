/**
 * 店舗キオスクPINの設定・状態・解除（管理/店長向け）。
 *
 *   GET    ?storeId= … PIN設定済みか・ロック状態
 *   PUT    { storeId, pin } … 6桁PINを設定/変更（scryptハッシュ保存・失敗カウンタ解除）
 *   DELETE ?storeId= … PINを解除（iPadはPINログイン不可に戻る）
 *
 * 認可は requireBaggageAccess（super_admin/tenant_admin/店舗管理者/手荷物検査店長・店舗スコープ）。
 * 書き込みは service role。平文PINは保存しない。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBaggageAccess } from '@/lib/baggage/kiosk-guard'
import { hashPin, isValidPinFormat, isLocked } from '@/lib/baggage/kiosk-pin'

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId')
  const guard = await requireBaggageAccess(storeId)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { data } = await guard.svc
    .from('baggage_kiosk_pins')
    .select('locked_until, updated_at')
    .eq('store_id', guard.store.id)
    .maybeSingle()
  const lockedUntil = data?.locked_until ? new Date(data.locked_until) : null
  return NextResponse.json({
    isSet: !!data,
    locked: isLocked(lockedUntil, new Date()),
    lockedUntil: lockedUntil?.toISOString() ?? null,
    updatedAt: data?.updated_at ?? null,
  })
}

const PutBody = z.object({ storeId: z.string().uuid(), pin: z.string() })

export async function PUT(req: NextRequest) {
  const parsed = PutBody.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  if (!isValidPinFormat(parsed.data.pin)) return NextResponse.json({ error: 'invalid_pin_format' }, { status: 400 })

  const guard = await requireBaggageAccess(parsed.data.storeId)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { error } = await guard.svc.from('baggage_kiosk_pins').upsert({
    store_id: guard.store.id,
    tenant_id: guard.store.tenantId,
    pin_hash: hashPin(parsed.data.pin),
    failed_attempts: 0,
    locked_until: null,
    updated_by: guard.user.id,
    updated_at: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: 'pin_save_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('storeId')
  const guard = await requireBaggageAccess(storeId)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { error } = await guard.svc.from('baggage_kiosk_pins').delete().eq('store_id', guard.store.id)
  if (error) return NextResponse.json({ error: 'pin_delete_failed' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
