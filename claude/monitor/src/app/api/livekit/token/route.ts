import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AccessToken } from 'livekit-server-sdk'
import { livekitEnabled, roomForCamera, LIVEKIT_VIEWER_TTL_SEC } from '@/lib/livekit'

/**
 * POST /api/livekit/token — カメラ視聴者向けの LiveKit **購読**トークン発行（SFUベータ）。
 *
 * Body: { cameraId }
 *
 * セキュリティ（旧実装の認可欠陥を是正）:
 *  - room は **サーバがカメラIDから導出**（クライアントの任意 room 指定を廃止）。
 *  - **RLS 可視性を検証**（見えないカメラは 403）。
 *  - **canPublish=false（購読専用）**／**identity=user.id（なりすまし不可）**。
 *    ＝ 視聴者は他人の room への配信注入も、別人へのなりすましもできない。
 *  - 機能フラグ LIVEKIT_ENABLED='true'＋creds のときのみ有効（既定 404）。
 *
 * 配信(publish)は monitor 起点（/api/livekit/publish が Ingress 発行＋start_sfu dispatch）。視聴者トークンでは配信不可。
 */
export async function POST(req: NextRequest) {
  if (!livekitEnabled()) {
    return NextResponse.json({ error: 'livekit_disabled' }, { status: 404 })
  }

  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { cameraId?: string } | null
  const cameraId = body?.cameraId?.trim()
  if (!cameraId) return NextResponse.json({ error: 'cameraId_required' }, { status: 400 })

  // RLS スコープでカメラ可視性を検証。可視外は null → 403（room 導出前にゲート）。
  const { data: cam } = await supa
    .from('recorder_cameras')
    .select('id')
    .eq('id', cameraId)
    .single()
  if (!cam) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const room = roomForCamera(cameraId)
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    { identity: user.id, ttl: LIVEKIT_VIEWER_TTL_SEC },
  )
  at.addGrant({ roomJoin: true, room, canPublish: false, canSubscribe: true })

  return NextResponse.json({
    url:   process.env.LIVEKIT_URL,
    room,
    token: await at.toJwt(),
  })
}
