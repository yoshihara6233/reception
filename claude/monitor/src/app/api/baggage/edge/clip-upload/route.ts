/**
 * POST /api/baggage/edge/clip-upload — エッジ向け クリップアップロード先の発行
 *
 * クリップ(最大100MB)は Vercel のボディ上限(4.5MB)を通せないため、エッジには
 * R2 の presigned PUT を渡して直接アップロードさせる。R2 未設定のうちは
 * mode:'supabase' を返し、エッジは従来どおり Supabase Storage へ上げる
 * （env 設定だけで切替でき、エッジ更新とデプロイの順序に依存しない）。
 *
 * 認証: Authorization: Bearer <device_token>（巡回 ingest と同形）。
 * このエッジの店舗の作業 (inspection_clip_jobs) にある組だけに発行する (2026-10-31・ASVS 2.2.3。
 * 以前は ID の形しか見ず、ほかのエッジの分のアップロード先も発行できた)。
 * 発行するキーはジョブと同じ決定的パス <sessionId>/<cameraId>.mp4 のみ＝
 * トークン保持エッジでも任意キーへは書けない。
 */
import { NextRequest, NextResponse } from 'next/server'
import { invalidInput } from '@/lib/api/invalid-input'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { r2Configured, presignClipPut, toR2Path } from '@/lib/baggage/r2'
import { authenticateEdge } from '@/lib/edge/device-auth'

const Body = z.object({
  sessionId: z.string().uuid(),
  cameraId: z.string().uuid(),
})

export async function POST(req: NextRequest) {
  // ── 1. device_token 認証 ──
  // authenticateEdge: 失敗を edge.auth_failed に記録し、止めたテナントの拠点も断る (ASVS 16.3.1・7.4.2)
  const edge = await authenticateEdge(req)
  const svc = createSupabaseService()
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  // ── 2. 入力 ──
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return invalidInput(req, { error: 'invalid_body' })
  const { sessionId, cameraId } = parsed.data

  // このエッジの店舗の作業か (確かめられないときは発行しない)
  if (!edge.store_id) return NextResponse.json({ error: 'job_not_found' }, { status: 403 })
  const { data: job, error: jobErr } = await svc
    .from('inspection_clip_jobs')
    .select('id')
    .eq('session_id', sessionId)
    .eq('camera_id', cameraId)
    .eq('store_id', edge.store_id)
    .limit(1)
    .maybeSingle()
  if (jobErr) return NextResponse.json({ error: 'job_check_failed' }, { status: 503 })
  if (!job) return NextResponse.json({ error: 'job_not_found' }, { status: 403 })

  // ── 3. R2 未設定 → 従来どおり Supabase へ ──
  if (!r2Configured()) return NextResponse.json({ mode: 'supabase' })

  const key = `${sessionId}/${cameraId}.mp4`
  try {
    const url = await presignClipPut(key)
    return NextResponse.json({ mode: 'r2', url, storagePath: toR2Path(key) })
  } catch (e) {
    // presign 失敗でもクリップを止めない（エッジは Supabase フォールバック）。
    console.error('[baggage clip-upload] presign failed → supabase fallback', String(e))
    return NextResponse.json({ mode: 'supabase' })
  }
}
