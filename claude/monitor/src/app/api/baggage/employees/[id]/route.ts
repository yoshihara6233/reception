/**
 * DELETE /api/baggage/employees/[id] — 従業員の登録抹消（M4）
 *
 * status=inactive にし、常設コレクションから顔を削除・顔列をクリアする
 * （キオスク画面の掲示「従業員=登録抹消まで」の実装）。行は履歴参照のため残す。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { requireBaggageAccess } from '@/lib/baggage/kiosk-guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/admin/audit'
import { deleteFaceInCollection, employeeCollectionId } from '@/lib/aws/rekognition'

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  // 認証を先に（未認証者への UUID 存在オラクル・認証前の service 読みを作らない）
  const auth = await requireAdmin()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

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

  // Rekognition から顔を削除。失敗時は DB をクリアしない（FaceId を失うと常設
  // コレクションに顔が孤児として残り続け、退職者が認証され続けるため — 再試行可能に保つ）。
  if (emp.rekognition_face_id) {
    try {
      await deleteFaceInCollection(employeeCollectionId(store.id), emp.rekognition_face_id)
    } catch (e) {
      return NextResponse.json(
        { error: 'rekognition_delete_failed', detail: (e as Error).message },
        { status: 502 },
      )
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
