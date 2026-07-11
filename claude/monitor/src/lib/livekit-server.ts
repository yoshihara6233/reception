/**
 * SFU（LiveKit）server-only ヘルパー。ingress 発行と start_sfu ディスパッチ。
 *
 * publish（配信）の起点はエッジではなく **monitor サーバ**：viewer が SFU を開くと
 * monitor が Ingress(WHIP) を発行し、その whip_url を start_sfu コマンドでエッジへ渡す。
 * → エッジに LiveKit 鍵は不要（whip_url がストリームキー同梱の自己認証URL）。
 */
import { IngressClient, IngressInput } from 'livekit-server-sdk'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EdgeCommand } from '@/lib/edge/commands'

const INGRESS_INACTIVE = 0            // livekit-server-sdk: 0=INACTIVE
const RETRY_BACKOFF_MS = 1500

/**
 * 指定 room 向けの **RTMP** Ingress を1つ確保し publish 用 URL（rtmp://…/streamKey）を返す。
 * RTMP を使う理由: 現地エッジの ffmpeg に WHIP muxer が無い（RTMP/FLV は全ビルドに存在）。
 * quota 衛生: 同 room の ingress は貼り替え（削除）、他 room の INACTIVE も掃除。429 は1回リトライ。
 */
export async function createSfuIngress(room: string, identity: string): Promise<string> {
  const httpsUrl = (process.env.LIVEKIT_URL ?? '').replace(/^wss?:\/\//, 'https://')
  const ic = new IngressClient(httpsUrl, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!)

  try {
    const all = await ic.listIngress()
    const stale = all.filter((i) => i.roomName === room || i.state?.status === INGRESS_INACTIVE)
    await Promise.all(stale.map((i) => ic.deleteIngress(i.ingressId)))
  } catch { /* best-effort GC */ }

  const params = { name: `sfu-${identity}`, roomName: room, participantIdentity: identity, participantName: identity }
  let created
  try {
    created = await ic.createIngress(IngressInput.RTMP_INPUT, params)
  } catch (e) {
    if ((e as { status?: number }).status === 429) {
      await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS))
      created = await ic.createIngress(IngressInput.RTMP_INPUT, params)
    } else {
      throw e
    }
  }
  if (!created.url || !created.streamKey) throw new Error('ingress_create_failed')
  return `${created.url}/${created.streamKey}`
}

/** start_sfu コマンドを生成（request_id は毎回新規）。publishUrl は RTMP Ingress の URL。 */
export function buildStartSfuCommand(cameraId: string, room: string, publishUrl: string): EdgeCommand {
  return { action: 'start_sfu', request_id: randomUUID(), camera_id: cameraId, room, publish_url: publishUrl }
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
