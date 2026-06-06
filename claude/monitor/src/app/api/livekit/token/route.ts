import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AccessToken } from 'livekit-server-sdk'

/** Default token lifetime (live/grid): 5 minutes. */
const DEFAULT_TTL_SECONDS = 5 * 60
/** Upper bound (VOD long-range sessions): 90 minutes. */
const MAX_TTL_SECONDS = 90 * 60

/**
 * Issue a short-lived LiveKit access token for a participant.
 * Body: { room: string, identity?: string, can_publish?: boolean, ttl_seconds?: number }
 *
 * VOD sessions can run far longer than the 5-minute default, so callers may
 * request up to MAX_TTL_SECONDS (90 min). Values are clamped to that ceiling.
 */
export async function POST(req: NextRequest) {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { room, identity, can_publish, ttl_seconds } = (await req.json()) as {
    room: string
    identity?: string
    can_publish?: boolean
    ttl_seconds?: number
  }
  if (!room) return NextResponse.json({ error: 'room_required' }, { status: 400 })

  const ttl =
    typeof ttl_seconds === 'number' && Number.isFinite(ttl_seconds) && ttl_seconds > 0
      ? Math.min(Math.floor(ttl_seconds), MAX_TTL_SECONDS)
      : DEFAULT_TTL_SECONDS

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
    { identity: identity ?? user.id, ttl },
  )
  at.addGrant({
    roomJoin: true,
    room,
    canPublish: !!can_publish,
    canSubscribe: true,
  })

  return NextResponse.json({
    url:   process.env.LIVEKIT_URL,
    token: await at.toJwt(),
  })
}
