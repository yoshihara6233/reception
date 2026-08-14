/**
 * POST /api/baggage/edge/clip-upload — エッジ向け クリップアップロード先の発行
 *
 * クリップ(最大100MB)は Vercel のボディ上限(4.5MB)を通せないため、エッジには
 * R2 の presigned PUT を渡して直接アップロードさせる。R2 未設定のうちは
 * mode:'supabase' を返し、エッジは従来どおり Supabase Storage へ上げる
 * （env 設定だけで切替でき、エッジ更新とデプロイの順序に依存しない）。
 *
 * 認証: Authorization: Bearer <device_token>（巡回 ingest と同形）。
 * 発行するキーはジョブと同じ決定的パス <sessionId>/<cameraId>.mp4 のみ＝
 * トークン保持エッジでも任意キーへは書けない。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { r2Configured, presignClipPut, toR2Path } from '@/lib/baggage/r2'
import { hashDeviceToken } from '@/lib/edge/device-token'

const Body = z.object({
  sessionId: z.string().uuid(),
  cameraId: z.string().uuid(),
})

export async function POST(req: NextRequest) {
  // ── 1. device_token 認証 ──
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!token) return NextResponse.json({ error: 'missing device token' }, { status: 401 })

  const svc = createSupabaseService()
  const { data: edge } = await svc
    .from('edge_devices')
    .select('id')
    .eq('device_token_hash', hashDeviceToken(token))
    .maybeSingle()
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  // ── 2. 入力 ──
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { sessionId, cameraId } = parsed.data

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
