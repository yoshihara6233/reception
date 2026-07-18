/**
 * エッジが検査クリップをアップロードするための署名URLを発行する（T5）
 *
 * POST /api/v1/baggage/edge/clip-jobs/:id/upload-url
 *   ヘッダ: x-edge-token / x-edge-api-version
 *   非公開バケット baggage-clips に対する短寿命の署名アップロードURLを返す。
 *   エッジはこの URL へ直接 PUT する（Vercel 関数の body 上限 4.5MB を回避し、
 *   大容量転送を Vercel 経由にしない）。
 *
 * res: { path, token, signedUrl }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateEdge } from '@/lib/edge/auth'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateEdge(req.headers)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: auth.status })

  const { id } = await params
  const supabase = createAdminClient()

  const { data: job } = await supabase
    .from('inspection_clip_jobs')
    .select('id, store_id, session_id, camera_id')
    .eq('id', id)
    .maybeSingle()

  // 自店舗のジョブでなければ 404（存在秘匿・越境防止）
  if (!job || job.store_id !== auth.storeId) {
    return NextResponse.json({ error: 'job not found' }, { status: 404 })
  }

  const path = `${job.session_id}/${job.camera_id ?? 'cam'}.mp4`
  const { data: signed, error } = await supabase.storage
    .from('baggage-clips')
    .createSignedUploadUrl(path, { upsert: true })

  if (error || !signed) {
    return NextResponse.json({ error: 'failed to create upload url' }, { status: 500 })
  }

  return NextResponse.json({ path: signed.path, token: signed.token, signedUrl: signed.signedUrl })
}
