/**
 * 遠隔視聴の指示を拠点へ渡す（GET /api/edge/commands/next から呼ぶ）。
 *
 * video_sessions から次の 1 件を選び（session-logic.ts の pickVideoAction）、指示の本文を
 * **その場で**組み立てる。署名付きの送り先はここで払い出し、DB には置かない（§6）。
 *
 * 状態の書き換えは「いまの状態が想定どおりなら」の条件付きで行う（二重に渡さない）。
 * 拠点のポーリングは 1 本ずつだが、再送や重なりで同じ行を 2 回選んでも害が無いように。
 */
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { presignVideoUpload, videoR2Configured, type VideoUpload } from '@/lib/storage/video-r2'
import { livekitEnabled } from '@/lib/livekit'
import { createGvmsIngress, deleteGvmsIngress } from '@/lib/livekit-server'
import { ACTIVE_STATES, pickVideoAction, type DispatchRow } from '@/lib/video/session-logic'

export interface VideoViewer { id: string; name: string }

/** 拠点へ渡す遠隔視聴の指示（§5.1〜§5.3）。upload には署名が入る — ログに出さない。 */
export type VideoCommand =
  | {
      action: 'start_hls_live'; request_id: string; session_id: string; camera_id: string
      stream: 'sub' | 'main'; viewer: VideoViewer; upload: VideoUpload
    }
  | {
      action: 'start_hls_vod'; request_id: string; session_id: string; camera_id: string
      from: string; to: string; viewer: VideoViewer; upload: VideoUpload
    }
  | {
      // §5.4。whip_url はストリームキー入りの自己認証 URL — ログ・DB に出さない
      action: 'start_sfu'; request_id: string; session_id: string; camera_id: string
      stream: 'sub' | 'main'; room: string; whip_url: string; viewer: VideoViewer
    }
  | { action: 'refresh_video'; request_id: string; session_id: string }
  | { action: 'stop_video'; request_id: string; session_id: string }

export interface SessionRow extends DispatchRow {
  camera_id: string
  stream: 'sub' | 'main'
  vod_from: string | null
  vod_to: string | null
  user_id: string
  viewer_name: string
  ingress_id?: string | null
}

const COLS =
  'id, kind, state, camera_id, stream, vod_from, vod_to, user_id, viewer_name, ' +
  'viewer_seen_at, stop_requested_at, refresh_sent_at, dispatched_at, ingress_id'

/** 1 回のポーリングで試す上限（drop・払い出しの失敗で指示にならない行を飛ばす分）。 */
const MAX_TRIES = 6

export async function nextVideoCommand(svc: SupabaseClient, edgeId: string, now = new Date()): Promise<VideoCommand | null> {
  const { data, error } = await svc
    .from('video_sessions')
    .select(COLS)
    .eq('edge_id', edgeId)
    .in('state', ACTIVE_STATES as string[])
  if (error || !data || data.length === 0) return null

  const rows = data as unknown as SessionRow[]
  const nowIso = now.toISOString()
  for (let i = 0; i < MAX_TRIES; i++) {
    const act = pickVideoAction(rows, now.getTime())
    if (!act) return null
    const row = act.row
    // 次の周回で同じ行を選ばないよう、手元の写しも進めておく
    const settle = (patch: Partial<SessionRow>) => Object.assign(row, patch)

    if (act.type === 'drop') {
      await svc.from('video_sessions')
        .update({ state: 'stopped', ended_at: nowIso })
        .eq('id', row.id).eq('state', 'requested')
      settle({ state: 'stopped' })
      continue
    }

    if (act.type === 'stop') {
      const { data: claimed } = await svc.from('video_sessions')
        .update({ state: 'stopped', ended_at: nowIso, stop_requested_at: row.stop_requested_at ?? nowIso })
        .eq('id', row.id).in('state', ['dispatched', 'started'])
        .select('id')
      settle({ state: 'stopped' })
      if (!claimed || claimed.length === 0) continue
      const cmd: VideoCommand = { action: 'stop_video', request_id: randomUUID(), session_id: row.id }
      await logRun(svc, edgeId, cmd)
      // SFU の受け口は止めた時点で片付ける（§5.4.1）。拠点の DELETE と前後しても害は無い。
      // 失敗しても cron が拾い直す
      if (row.kind === 'sfu' && row.ingress_id) await purgeIngress(svc, row.id, row.ingress_id, nowIso)
      return cmd
    }

    if (act.type === 'refresh') {
      await svc.from('video_sessions').update({ refresh_sent_at: nowIso }).eq('id', row.id)
      settle({ refresh_sent_at: nowIso })
      // 合図は 30 秒ごとに来るので edge_command_runs には残さない（拠点も結果を返さない）
      return { action: 'refresh_video', request_id: randomUUID(), session_id: row.id }
    }

    // start
    const built = await buildStart(row, edgeId)
    const cmd = built?.cmd ?? null
    if (!built || !cmd) {
      await svc.from('video_sessions')
        .update({ state: 'error', error: 'internal', ended_at: nowIso })
        .eq('id', row.id).eq('state', 'requested')
      settle({ state: 'error' })
      continue
    }
    const { data: claimed } = await svc.from('video_sessions')
      .update({ state: 'dispatched', start_request_id: cmd.request_id, dispatched_at: nowIso, ...built.patch })
      .eq('id', row.id).eq('state', 'requested')
      .select('id')
    settle({ state: 'dispatched', dispatched_at: nowIso })
    if (!claimed || claimed.length === 0) {
      // 別のポーリングが先に渡した。こちらで作った受け口は使われないので消す
      if (built.patch.ingress_id) await deleteGvmsIngress(built.patch.ingress_id)
      continue
    }
    await logRun(svc, edgeId, cmd)
    return cmd
  }
  return null
}

interface BuiltStart {
  cmd: VideoCommand
  /** 開始を渡すときに行へ書く列（SFU の受け口の ID と部屋） */
  patch: { ingress_id?: string; room?: string }
}

async function buildStart(row: SessionRow, edgeId: string): Promise<BuiltStart | null> {
  const viewer: VideoViewer = { id: row.user_id, name: row.viewer_name }
  const request_id = randomUUID()
  if (row.kind === 'sfu') {
    // 受け口を作ってから指示を出す（§5.4.1）。作れなければ失敗として閉じる
    if (!livekitEnabled()) return null
    let ing
    try {
      ing = await createGvmsIngress(row.id, edgeId)
    } catch (e) {
      console.error('[video/dispatch] SFU の受け口を作れません:', (e as Error).message)
      return null
    }
    return {
      cmd: {
        action: 'start_sfu', request_id, session_id: row.id, camera_id: row.camera_id,
        stream: row.stream, room: ing.room, whip_url: ing.whipUrl, viewer,
      },
      patch: { ingress_id: ing.ingressId, room: ing.room },
    }
  }
  const cmd = await buildHlsStart(row, viewer, request_id)
  return cmd ? { cmd, patch: {} } : null
}

async function buildHlsStart(row: SessionRow, viewer: VideoViewer, request_id: string): Promise<VideoCommand | null> {
  if (row.kind === 'hls_live' || row.kind === 'hls_vod') {
    if (!videoR2Configured()) return null
    let upload: VideoUpload
    try {
      upload = await presignVideoUpload(row.id, row.kind)
    } catch {
      return null
    }
    if (row.kind === 'hls_live') {
      return {
        action: 'start_hls_live', request_id, session_id: row.id, camera_id: row.camera_id,
        stream: row.stream, viewer, upload,
      }
    }
    if (!row.vod_from || !row.vod_to) return null
    return {
      action: 'start_hls_vod', request_id, session_id: row.id, camera_id: row.camera_id,
      from: new Date(row.vod_from).toISOString(), to: new Date(row.vod_to).toISOString(), viewer, upload,
    }
  }
  return null
}

/** SFU の受け口を消し、片付け済みの印を付ける。消せなければ印を付けない（cron が拾い直す）。 */
export async function purgeIngress(svc: SupabaseClient, id: string, ingressId: string, nowIso: string): Promise<boolean> {
  if (!(await deleteGvmsIngress(ingressId))) return false
  await svc.from('video_sessions').update({ purged_at: nowIso }).eq('id', id)
  return true
}

/** 監視用の受領記録（従来の指示と同じ表）。失敗しても指示は渡す。 */
async function logRun(svc: SupabaseClient, edgeId: string, cmd: VideoCommand): Promise<void> {
  await svc.from('edge_command_runs').insert({ request_id: cmd.request_id, edge_id: edgeId, action: cmd.action })
}

/**
 * 拠点が返した起動の成否（commands/result）をセッションへ写す。
 * 開始の指示でなければ 0 行一致で素通り。
 */
export async function applyStartResult(
  svc: SupabaseClient, edgeId: string, requestId: string, ok: boolean, error: string | null,
): Promise<void> {
  const nowIso = new Date().toISOString()
  if (ok) {
    await svc.from('video_sessions')
      .update({ state: 'started', started_at: nowIso })
      .eq('start_request_id', requestId).eq('edge_id', edgeId).eq('state', 'dispatched')
    return
  }
  await svc.from('video_sessions')
    .update({ state: 'error', error, ended_at: nowIso })
    .eq('start_request_id', requestId).eq('edge_id', edgeId).in('state', ['dispatched', 'started'])
}
