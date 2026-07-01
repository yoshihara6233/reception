/**
 * Edge command contract shared by:
 *   - claude/monitor (cloud API → sends commands)
 *   - claude/edge-agent (on-site → consumes commands)
 *
 * Transport: the edge-agent polls `edge_devices.pending_command` (jsonb)
 * every ~2s and executes the action found there. (Not Supabase Realtime
 * broadcast — that was the original design but the shipped agent polls.)
 */

export type EdgeCommand =
  | { action: 'start_grid';  request_id: string }
  | { action: 'stop_grid';   request_id: string }
  // start_live: edge polls the camera's HTTP snapshot endpoint and uploads
  // each JPEG to per-camera storage. No LiveKit, no WHIP — just `camera_id`.
  | { action: 'start_live';  request_id: string; camera_id: string }
  // F77 / Phase 8.4-B — start_vod is Storage Direct: the cloud's POST /api/vod
  // creates a vod_clips row (status='queued') and forwards its id here as
  // clip_id. The edge fetches Frigate clip.mp4, uploads to the vod-clips
  // bucket, and flips the row to ready. LiveKit WHIP fields are kept
  // optional during the rollout window so older edge agents don't fail
  // the Zod parse — they're ignored by the new vod.ts.
  | { action: 'start_vod';   request_id: string; camera_id: string; clip_id: string; from_iso: string; to_iso: string; livekit_room?: string; livekit_whip_url?: string }
  | { action: 'stop_stream'; request_id: string }
  | { action: 'reboot';      request_id: string }
  // 警備: 巡回スナップショット取得。指定カメラの静止画を撮り、ingest API に POST する。
  | { action: 'capture_snapshot'; request_id: string; run_id: string; camera_ids: string[]; ingest_url: string }
  // 発報前後スナップ（PB7）: 1 発報につき全カメラ×秒オフセットの録画フレームを抽出し ingest_url へ POST。
  | { action: 'capture_alarm_timeline'; request_id: string; alarm_id: string; occurred_at: string; offsets_sec: number[]; ingest_url: string }
  // BCP/J-Alert: 事象発生時にエッジ側でクリップを録画して BCP ストレージへアップロード。
  // bcp/test/route.ts から発火。エッジ側 (modes/bcp.ts) が消費する。
  | { action: 'start_bcp_capture'; request_id: string; eventId: string; clips: Array<{ clipId: string; cameraId: string }>; clipFrom: string; clipTo: string; offsets?: number[] }

export type EdgeAck =
  | { request_id: string; ok: true;  agent_version: string }
  | { request_id: string; ok: false; error: string }

export function edgeChannelName(edgeId: string): string {
  return `edge:commands:${edgeId}`
}
