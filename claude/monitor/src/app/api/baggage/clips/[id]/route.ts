/**
 * GET /api/baggage/clips/[id] — 検査クリップの署名URLプロキシ（M4・F76 同形）
 *
 * 1. セッション確認 → 2. inspection_clips を RLS 越しに読む（可視性チェック）
 * 3. baggage-clips を service role で署名 → 4. 短命署名URLへ 302
 * 閲覧は footage_access_log（baggage_clip・5分dedup）に記録（G3）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { recordFootageAccess } from '@/lib/audit/footage-access'
import { isR2Path, r2Key, presignClipGet } from '@/lib/baggage/r2'

const BUCKET = 'baggage-clips'
const SIGNED_TTL = 300   // 動画はスクラブで再リクエストされるため長め

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params

  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  // RLS 越し: 見えるクリップのみ行が返る
  const { data: clip } = await supa
    .from('inspection_clips')
    .select('id, store_id, camera_id, storage_path, upload_status')
    .eq('id', id)
    .maybeSingle()
  if (!clip || clip.upload_status !== 'done') return new NextResponse('Not Found', { status: 404 })

  await recordFootageAccess({
    actorUserId: user.id, storeId: clip.store_id, accessType: 'baggage_clip',
    resourceId: id, cameraId: clip.camera_id,
  })

  // R2 保存分（storage_path が r2: プレフィックス）は presigned GET へ 302。
  // エグレス無料のため全件確認再生でも転送費ゼロ（handbook §15.3）。
  if (isR2Path(clip.storage_path)) {
    try {
      const url = await presignClipGet(r2Key(clip.storage_path), SIGNED_TTL)
      return NextResponse.redirect(url, 302)
    } catch (e) {
      console.error('[baggage clips] R2 presign failed', String(e))
      return new NextResponse('Sign Failed', { status: 500 })
    }
  }

  const svc = createSupabaseService()
  const { data: signed, error } = await svc.storage.from(BUCKET).createSignedUrl(clip.storage_path, SIGNED_TTL)
  if (error || !signed?.signedUrl) return new NextResponse('Sign Failed', { status: 500 })
  return NextResponse.redirect(signed.signedUrl, 302)
}
