import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { IngressClient, IngressInput } from 'livekit-server-sdk'

/**
 * Create a one-shot WHIP ingress for the edge to publish into.
 *
 * Why this exists: LiveKit Cloud's WHIP endpoint lives on a SEPARATE
 * subdomain (`<project>.whip.livekit.cloud`) and authenticates via an
 * Ingress-issued stream key in the URL path, NOT via a participant JWT.
 * Trying to POST a WHIP offer to `<project>.livekit.cloud/rtc/whip?token=...`
 * just gets back HTTP 200 "OK" (the project SFU's default response) which
 * ffmpeg can't parse as an SDP answer — the symptom is
 * `[WHIP muxer] Invalid answer: OK` and immediate ffmpeg exit.
 *
 * Body: { room: string, identity: string, name?: string }
 * Returns: { whip_url: string } — concatenated publish URL ready to feed
 *          straight into ffmpeg `-f whip`. No further token wiring needed
 *          on the edge.
 *
 * Each call creates a fresh ingress; LiveKit auto-cleans idle ingresses, so
 * we don't track ids here. Cleanup-on-stop is a future optimisation.
 */
export async function POST(req: NextRequest) {
  const supa = await createSupabaseServer()
  const { data: { user } } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { room, identity, name } = (await req.json()) as {
    room: string
    identity: string
    name?: string
  }
  if (!room)     return NextResponse.json({ error: 'room_required' },     { status: 400 })
  if (!identity) return NextResponse.json({ error: 'identity_required' }, { status: 400 })

  // IngressClient takes the HTTPS form of the project URL (it calls the
  // Ingress twirp API on the main project domain — the WHIP publish URL
  // it returns is on the .whip. subdomain).
  const httpsUrl = (process.env.LIVEKIT_URL ?? '').replace(/^wss?:\/\//, 'https://')
  const ic = new IngressClient(
    httpsUrl,
    process.env.LIVEKIT_API_KEY!,
    process.env.LIVEKIT_API_SECRET!,
  )

  // Quota hygiene: LiveKit Cloud caps total ingress objects per project
  // (free tier ≈ 2). Each live / VOD-seek creates a fresh ingress, so
  // without cleanup the quota fills up after a few interactions and
  // createIngress returns 429.
  //
  // GC strategy:
  //   * ingresses in the same room: delete regardless of state (we're about
  //     to replace them — this is the seek-and-resume case).
  //   * ingresses in OTHER rooms: delete only if their state is
  //     ENDPOINT_INACTIVE (0). That covers the common case where a previous
  //     live session left an ingress behind that nobody is using. Active
  //     publishes from other rooms are preserved.
  //
  // The state enum values come from livekit-server-sdk: 0=INACTIVE,
  // 1=BUFFERING, 2=PUBLISHING, 3=ERROR, 4=COMPLETE.
  const INGRESS_INACTIVE = 0
  try {
    const all = await ic.listIngress()
    const stale = all.filter(
      (i) => i.roomName === room || i.state?.status === INGRESS_INACTIVE,
    )
    await Promise.all(stale.map((i) => ic.deleteIngress(i.ingressId)))
  } catch {
    // Best-effort; if listing/deleting fails, fall through and try to create.
  }

  // LiveKit's per-project ingress counter has a brief propagation lag after
  // a delete — the GC above can free a slot but the immediately-following
  // createIngress sometimes still sees the old count and returns
  // 429 "total ingress object limit exceeded". Retry once after a short
  // backoff before giving up.
  const RETRY_BACKOFF_MS = 1500
  const createParams = {
    name: name ?? `ingress-${identity}`,
    roomName:            room,
    participantIdentity: identity,
    participantName:     identity,
  }
  let created
  try {
    created = await ic.createIngress(IngressInput.WHIP_INPUT, createParams)
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string }
    if (err.status === 429) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS))
      try {
        created = await ic.createIngress(IngressInput.WHIP_INPUT, createParams)
      } catch (e2: unknown) {
        const err2 = e2 as { status?: number; message?: string }
        return NextResponse.json(
          { error: 'ingress_create_failed', detail: err2.message ?? String(e2) },
          { status: err2.status === 429 ? 429 : 502 },
        )
      }
    } else {
      return NextResponse.json(
        { error: 'ingress_create_failed', detail: err.message ?? String(e) },
        { status: 502 },
      )
    }
  }

  if (!created.url || !created.streamKey) {
    return NextResponse.json({ error: 'ingress_create_failed' }, { status: 502 })
  }

  // createIngress returns the base URL (no trailing slash) and the stream key
  // separately; the canonical WHIP publish URL is `${url}/${streamKey}`.
  const whipUrl = `${created.url}/${created.streamKey}`

  return NextResponse.json({ whip_url: whipUrl })
}
