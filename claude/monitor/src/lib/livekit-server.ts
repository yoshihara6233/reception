/**
 * SFU（LiveKit）server-only ヘルパー。ingress 発行と start_sfu ディスパッチ。
 *
 * publish（配信）の起点はエッジではなく **monitor サーバ**：viewer が SFU を開くと
 * monitor が Ingress(WHIP) を発行し、その whip_url を start_sfu コマンドでエッジへ渡す。
 * → エッジに LiveKit 鍵は不要（whip_url がストリームキー同梱の自己認証URL）。
 */
import { IngressClient, IngressInput, RoomServiceClient } from 'livekit-server-sdk'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EdgeCommand } from '@/lib/edge/commands'

const INGRESS_INACTIVE = 0            // livekit-server-sdk: 0=INACTIVE
const RETRY_BACKOFF_MS = 1500

function livekitHttpsUrl(): string {
  return (process.env.LIVEKIT_URL ?? '').replace(/^wss?:\/\//, 'https://')
}

/**
 * room に publisher（identity=edge_id の Ingress 参加者）が既に居るか。
 * コールドスタート短縮の fast-path 判定: 居れば Ingress 発行も start_sfu dispatch も
 * 不要（視聴者は subscribe するだけ ≒ 1秒）。room 不存在は「配信なし」。
 */
export async function isPublishing(room: string, edgeId: string): Promise<boolean> {
  try {
    const rsc = new RoomServiceClient(livekitHttpsUrl(), process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!)
    const participants = await rsc.listParticipants(room)
    return participants.some((p) => p.identity === edgeId)
  } catch {
    return false   // room 不存在 or API 不達 → コールドパスへ（安全側）
  }
}

/**
 * 指定 room 向けの **WHIP** Ingress を1つ確保し publish 用 URL（WHIP endpoint）を返す。
 * エッジは WHIP muxer 対応 ffmpeg で無変換 publish する（最低遅延）。
 * コールドスタート短縮: 同 room の既存 ingress は**再利用**（WHIP の url/streamKey は
 * セッションを跨いで安定。削除→再作成の API 3往復 ≒ 1秒を節約）。
 * quota 衛生: 他 room の INACTIVE のみ掃除。429 は1回リトライ。
 */
export async function createSfuIngress(room: string, identity: string): Promise<string> {
  const ic = new IngressClient(livekitHttpsUrl(), process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!)

  try {
    const all = await ic.listIngress()
    const mine = all.find((i) => i.roomName === room && i.url && i.streamKey)
    const stale = all.filter((i) => i.roomName !== room && i.state?.status === INGRESS_INACTIVE)
    await Promise.all(stale.map((i) => ic.deleteIngress(i.ingressId)))
    if (mine) return `${mine.url}/${mine.streamKey}`
  } catch { /* best-effort GC / 再利用不可 → 新規作成へ */ }

  const params = { name: `sfu-${identity}`, roomName: room, participantIdentity: identity, participantName: identity }
  let created
  try {
    created = await ic.createIngress(IngressInput.WHIP_INPUT, params)
  } catch (e) {
    if ((e as { status?: number }).status === 429) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS))
      created = await ic.createIngress(IngressInput.WHIP_INPUT, params)
    } else {
      throw e
    }
  }
  if (!created.url || !created.streamKey) throw new Error('ingress_create_failed')
  return `${created.url}/${created.streamKey}`
}

/** start_sfu コマンドを生成（request_id は毎回新規）。whipUrl は WHIP Ingress の publish URL。 */
export function buildStartSfuCommand(cameraId: string, room: string, whipUrl: string): EdgeCommand {
  return { action: 'start_sfu', request_id: randomUUID(), camera_id: cameraId, room, whip_url: whipUrl }
}

/**
 * pending_command が空いていれば SFU 配信コマンドを投入する（レース保護）。
 * 戻り値 true=投入成功 / false=スロット占有（クライアントは再試行）。
 */
export async function dispatchStartSfu(
  service: SupabaseClient,
  edgeId: string,
  cmd: EdgeCommand,
): Promise<boolean> {
  const { data } = await service
    .from('edge_devices')
    .update({ pending_command: cmd, pending_command_at: new Date().toISOString() })
    .eq('id', edgeId)
    .is('pending_command', null)
    .select('id')
  return (data ?? []).length > 0
}

/** stop_stream を投入し SFU 配信を止める（エッジを idle へ戻す）。 */
export async function dispatchStopStream(service: SupabaseClient, edgeId: string): Promise<void> {
  const cmd: EdgeCommand = { action: 'stop_stream', request_id: randomUUID() }
  await service
    .from('edge_devices')
    .update({ pending_command: cmd, pending_command_at: new Date().toISOString() })
    .eq('id', edgeId)
    .is('pending_command', null)
}
