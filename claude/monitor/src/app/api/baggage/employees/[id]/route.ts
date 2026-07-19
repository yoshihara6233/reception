/**
 * DELETE /api/baggage/employees/[id] — 従業員の登録抹消（M4）
 *
 * status=inactive にし、常設コレクションから顔を削除・顔列をクリアする
 * （キオスク画面の掲示「従業員=登録抹消まで」の実装）。行は履歴参照のため残す。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireBaggageAccess } from '@/lib/baggage/kiosk-guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/admin/audit'
import { deleteFaceInCollection, employeeCollectionId } from '@/lib/aws/rekognition'

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const svc0 = createSupabaseService()
  const { data: emp } = await svc0
    .from('employees')
    .select('id, store_id, rekognition_face_id, face_photo_path')
    .eq('id', id)
    .maybeSingle()
  if (!emp) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const guard = await requireBaggageAccess(emp.store_id)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const { svc, store } = guard

  // Rekognition から顔を削除（未設定・不存在は握る — DB 側のクリアを優先）
  if (emp.rekognition_face_id) {
    try {
      await deleteFaceInCollection(employeeCollectionId(store.id), emp.rekognition_face_id)
    } catch (e) {
      console.warn('[baggage] rekognition face delete failed:', (e as Error).message)
    }
  }
  if (emp.face_photo_path) {
    await svc.storage.from('baggage-photos').remove([emp.face_photo_path])
  }

  const { error } = await svc
    .from('employees')
    .update({ status: 'inactive', rekognition_face_id: null, face_photo_path: null })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id, action: 'baggage.employee.deactivate', targetType: 'employee',
    targetId: id, storeId: store.id,
  })
  return NextResponse.json({ ok: true })
}
