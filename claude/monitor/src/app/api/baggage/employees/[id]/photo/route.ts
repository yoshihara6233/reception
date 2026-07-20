/**
 * GET /api/baggage/employees/[id]/photo — 従業員の登録顔写真（署名URLプロキシ）
 *
 * 従業員マスタ一覧のサムネイル用。パスはクライアントから受けず、RLS/認可を
 * 通してから employees.face_photo_path を解決する（トラバーサル・越権の余地を作らない）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { requireBaggageAccess } from '@/lib/baggage/kiosk-guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordFootageAccess } from '@/lib/audit/footage-access'

const BUCKET = 'baggage-photos'
const SIGNED_TTL = 300

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const auth = await requireAdmin()
  if (!auth.ok) return new NextResponse('Unauthorized', { status: auth.status })

  const svc0 = createSupabaseService()
  const { data: emp } = await svc0
    .from('employees')
    .select('id, store_id, face_photo_path')
    .eq('id', id)
    .maybeSingle()
  if (!emp?.face_photo_path) return new NextResponse('Not Found', { status: 404 })

  const guard = await requireBaggageAccess(emp.store_id)
  if (!guard.ok) return new NextResponse('Forbidden', { status: guard.status })

  void recordFootageAccess({
    actorUserId: guard.user.id, storeId: emp.store_id, accessType: 'baggage_photo',
    resourceId: `employee:${id}`,
  })

  const { data: signed, error } = await guard.svc.storage
    .from(BUCKET).createSignedUrl(emp.face_photo_path, SIGNED_TTL)
  if (error || !signed?.signedUrl) return new NextResponse('Sign Failed', { status: 500 })
  return NextResponse.redirect(signed.signedUrl, 302)
}
