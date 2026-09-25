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
    // 掃除するのは従来のエッジ向け（cam_ の部屋）だけ。G・VMS の受け口（gvms_ の部屋）は
    // 拠点がつながるまで十数秒 INACTIVE のままなので、ここで消すと送り出しが始まらない。
    // G・VMS の受け口は video_sessions の片付け（cron/video-sessions）が消す
    const stale = all.filter((i) =>
      i.roomName !== room && i.roomName?.startsWith('cam_') && i.state?.status === INGRESS_INACTIVE)
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
 * スロット占有時（例: 直前モードの予約 stop_stream）は短間隔で数回リトライする —
 * エッジは 500ms ポーリングでスロットを消費するので、~2秒待てばほぼ確実に空く。
 * 戻り値 true=投入成功 / false=リトライ超過（クライアントは再試行 UI）。
 */
export async function dispatchStartSfu(
  service: SupabaseClient,
  edgeId: string,
  cmd: EdgeCommand,
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 700))
    const { data } = await service
      .from('edge_devices')
      .update({ pending_command: cmd, pending_command_at: new Date().toISOString() })
      .eq('id', edgeId)
      .is('pending_command', null)
      .select('id')
    if ((data ?? []).length > 0) return true
  }
  return false
}

/**
 * stop_sfu を投入し SFU 並行ワーカーを止める（sfu-reaper / publish stop）。
 * active モード（grid/軽量/vod）には触れない。スロット占有時は投入せず終了
 * （reaper は次 tick で再試行するため best-effort でよい）。
 */
export async function dispatchStopSfu(service: SupabaseClient, edgeId: string): Promise<void> {
  const cmd: EdgeCommand = { action: 'stop_sfu', request_id: randomUUID() }
  await service
    .from('edge_devices')
    .update({ pending_command: cmd, pending_command_at: new Date().toISOString() })
    .eq('id', edgeId)
    .is('pending_command', null)
}

// ---- G・VMS の SFU 遠隔ライブ（GVMS_CLOUD_SPEC §5.4）----
//
// 従来のエッジ向けと違い、**視聴 1 回（video_sessions の 1 行）に受け口 1 つ**を作る。
// 部屋も gvms_<session_id> に分ける — cam_ の部屋は sfu-reaper が視聴者 0 人で stop_sfu を
// 入れにいくため（nvmsd は stop_sfu を知らない指示として読み飛ばす）。
// 送り先の URL はストリームキー入りの自己認証 URL なので、whip_bearer は使わない。
// **URL は秘密**: DB・ログ・API 応答に出さない。DB には ingress_id だけを置く。

/** G・VMS の視聴 1 回の部屋名。 */
export function gvmsRoomForSession(sessionId: string): string {
  return `gvms_${sessionId}`
}

function ingressClient(): IngressClient {
  return new IngressClient(livekitHttpsUrl(), process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!)
}

export interface GvmsIngress { ingressId: string; room: string; whipUrl: string }

/**
 * G・VMS の視聴 1 回ぶんの WHIP 受け口を作る。拠点は H.264 で送ってくる（H.265 は拠点が
 * 変換する・§5.4.2）ので、受け口では変換しない（enableTranscoding=false が WHIP の既定）。
 */
export async function createGvmsIngress(sessionId: string, edgeId: string): Promise<GvmsIngress> {
  const room = gvmsRoomForSession(sessionId)
  const params = {
    name: `gvms-${sessionId}`, roomName: room,
    participantIdentity: `gvms-edge-${edgeId}`, participantName: 'G・VMS',
    enableTranscoding: false,
  }
  const ic = ingressClient()
  let created
  try {
    created = await ic.createIngress(IngressInput.WHIP_INPUT, params)
  } catch (e) {
    if ((e as { status?: number }).status !== 429) throw e
    await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS))
    created = await ic.createIngress(IngressInput.WHIP_INPUT, params)
  }
  if (!created.ingressId || !created.url || !created.streamKey) throw new Error('ingress_create_failed')
  return { ingressId: created.ingressId, room, whipUrl: `${created.url}/${created.streamKey}` }
}

/** 受け口を消す。もう無い（消し済み・期限切れ）ものは消えたとみなして true。 */
export async function deleteGvmsIngress(ingressId: string): Promise<boolean> {
  try {
    await ingressClient().deleteIngress(ingressId)
    return true
  } catch (e) {
    const status = (e as { status?: number }).status
    return status === 404
  }
}

/** 部屋に映像を送っている参加者（拠点）が居るか。部屋が無い・API に届かないときは false。 */
export async function roomHasPublisher(room: string): Promise<boolean> {
  try {
    const rsc = new RoomServiceClient(livekitHttpsUrl(), process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!)
    const participants = await rsc.listParticipants(room)
    return participants.some((p) => (p.tracks ?? []).length > 0)
  } catch {
    return false
  }
}
