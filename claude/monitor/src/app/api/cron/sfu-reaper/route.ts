/**
 * SFU 視聴0リーパー cron（S3.1: オンデマンド停止の確実化）。
 *
 * 通常はビューア unmount 時の /api/livekit/publish stop で配信が止まるが、
 * ブラウザクラッシュ・端末スリープ・回線断では stop が飛ばず、エッジが
 * 誰も見ていない room へ publish し続けて egress が漏れる。本 cron はその保険:
 *
 *   LiveKit の room 一覧 → cam_<id> room ごとに参加者を数え、
 *   **視聴者0（publisher=Ingress しかいない）** なら該当エッジへ stop_stream を投入。
 *
 * 判定の規約（自前の命名規則に基づく決定的判定）:
 *   - room 名は `cam_<cameraId>`（roomForCamera）。
 *   - publisher(Ingress) の participantIdentity は **edge_id**（createSfuIngress の identity）。
 *     → identity !== edge_id の参加者 = 視聴者。
 *   - 生成直後の room は視聴者接続前の可能性があるため GRACE_SEC 以内はスキップ。
 *
 * pending_command 占有中は dispatchStopStream が no-op（次回 tick で再試行）。
 * 認証: edge-health と同じ CRON_SECRET（Bearer / x-cron-secret）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { RoomServiceClient } from 'livekit-server-sdk'
import { createSupabaseService } from '@/lib/supabase/server'
import { livekitEnabled } from '@/lib/livekit'
import { dispatchStopStream } from '@/lib/livekit-server'

const ROOM_PREFIX = 'cam_'
const GRACE_SEC   = 120   // room 生成からの猶予（start 直後の視聴者接続待ち）

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 })
  const authed = req.headers.get('authorization') === `Bearer ${secret}`
    || req.headers.get('x-cron-secret') === secret
  if (!authed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  // フラグ OFF なら何もしない（正常系: SFU 未使用テナント）。
  if (!livekitEnabled()) return NextResponse.json({ ok: true, skipped: 'livekit_disabled' })

  const httpsUrl = (process.env.LIVEKIT_URL ?? '').replace(/^wss?:\/\//, 'https://')
  const rsc = new RoomServiceClient(httpsUrl, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!)
  const svc = createSupabaseService()

  let rooms
  try {
    rooms = await rsc.listRooms()
  } catch (e) {
    // LiveKit 到達不可はエッジ側で publish も失敗しているはずなので、エラーは返すが致命ではない。
    return NextResponse.json({ error: 'livekit_unreachable', detail: (e as Error).message }, { status: 502 })
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const reaped:  string[] = []
  const active:  string[] = []
  const skipped: string[] = []

  for (const room of rooms) {
    if (!room.name.startsWith(ROOM_PREFIX)) continue
    const cameraId = room.name.slice(ROOM_PREFIX.length)

    // 生成直後は視聴者がまだ接続中の可能性 → 猶予。creationTime は epoch 秒 (bigint)。
    const ageSec = nowSec - Number(room.creationTime ?? 0)
    if (ageSec < GRACE_SEC) { skipped.push(`${room.name}:grace`); continue }

    // camera → recorder → edge_id（service client・RLSバイパス。cron はユーザ文脈なし）。
    const { data: cam } = await svc
      .from('recorder_cameras')
      .select('recorders ( edge_id )')
      .eq('id', cameraId)
      .single()
    const edgeId = (cam as { recorders: { edge_id: string } | null } | null)?.recorders?.edge_id
    if (!edgeId) { skipped.push(`${room.name}:no_edge`); continue }

    let participants
    try {
      participants = await rsc.listParticipants(room.name)
    } catch { skipped.push(`${room.name}:list_failed`); continue }

    // 視聴者 = publisher(identity=edge_id) 以外。0 なら誰も見ていない。
    const viewers = participants.filter((p) => p.identity !== edgeId).length
    if (viewers > 0) { active.push(`${room.name}:${viewers}`); continue }

    await dispatchStopStream(svc, edgeId)
    reaped.push(room.name)
  }

  if (reaped.length > 0) console.log(`[sfu-reaper] stopped ${reaped.length} orphan publish: ${reaped.join(', ')}`)
  return NextResponse.json({ ok: true, reaped, active, skipped })
}
