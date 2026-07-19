/**
 * GET /api/baggage/sessions/[id]/photo?kind=entry|exit|employee|card
 *   — セッションに紐づく顔・名刺静止画の署名URLプロキシ（M4）
 *
 * パスはクライアントから受けず、RLS 越しに読んだセッション行から解決する
 * （パス指定型のプロキシにしない＝トラバーサル/越権の余地を作らない）。
 * 閲覧は footage_access_log（baggage_photo・5分dedup）に記録（G3）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { recordFootageAccess } from '@/lib/audit/footage-access'

const BUCKET = 'baggage-photos'
const SIGNED_TTL = 60

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const kind = req.nextUrl.searchParams.get('kind')
  if (!kind || !['entry', 'exit', 'employee', 'card'].includes(kind)) {
    return new NextResponse('Bad Request', { status: 400 })
  }

  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const { data: sess } = await supa
    .from('inspection_sessions')
    .select('id, store_id, entry_face_path, exit_face_path, card_photo_path, employees ( face_photo_path )')
    .eq('id', id)
    .maybeSingle()
  if (!sess) return new NextResponse('Not Found', { status: 404 })

  const emp = (Array.isArray(sess.employees) ? sess.employees[0] : sess.employees) as
    { face_photo_path: string | null } | null
  const path =
    kind === 'entry'    ? sess.entry_face_path
    : kind === 'exit'     ? sess.exit_face_path
    : kind === 'card'     ? sess.card_photo_path
    : emp?.face_photo_path ?? null
  if (!path) return new NextResponse('Not Found', { status: 404 })

  await recordFootageAccess({
    actorUserId: user.id, storeId: sess.store_id, accessType: 'baggage_photo',
    resourceId: `${id}:${kind}`,
  })

  const svc = createSupabaseService()
  const { data: signed, error } = await svc.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL)
  if (error || !signed?.signedUrl) return new NextResponse('Sign Failed', { status: 500 })
  return NextResponse.redirect(signed.signedUrl, 302)
}
