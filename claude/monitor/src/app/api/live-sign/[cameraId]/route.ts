/**
 * GET /api/live-sign/<cameraId> — リモート MJPEG ライブの署名URLを（再）発行する。
 *
 * ライブ画面初回は SSR で署名URLを埋め込むが、接続断→再接続で TTL を跨ぐと Worker が 403 に
 * なるため、クライアント（ImageStreamMode）が失敗時にここから新しい署名URLを取り直す。
 *
 * 認可: monitor ログイン必須 ＋ カメラは RLS スコープで可視（越権カメラは 404）。
 * 署名鍵未設定時は 404（＝クライアントは従来のCFログイン方式にフォールバック）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { buildRemoteMjpegUrl, signLiveUrl } from '@/lib/live-sign'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ cameraId: string }> },
) {
  const { cameraId } = await ctx.params

  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // RLS スコープでカメラ→レコーダ(live_host/vendor)を解決。可視外は null → 404。
  const { data: cam } = await supa
    .from('recorder_cameras')
    .select('frigate_camera, recorders ( live_host, vendor )')
    .eq('id', cameraId)
    .single()
  const row = cam as {
    frigate_camera: string | null
    recorders: { live_host: string | null; vendor: string } | null
  } | null
  if (row?.recorders?.vendor !== 'frigate') {
    return NextResponse.json({ error: 'not_frigate' }, { status: 404 })
  }

  const raw = buildRemoteMjpegUrl(row.recorders.live_host, row.frigate_camera)
  if (!raw) return NextResponse.json({ error: 'no_remote_host' }, { status: 404 })

  const signed = signLiveUrl(raw)
  if (!signed) return NextResponse.json({ error: 'signing_disabled' }, { status: 404 })

  return NextResponse.json({ url: signed }, { headers: { 'Cache-Control': 'no-store' } })
}
