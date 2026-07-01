// Mirror of cloud-side EdgeCommand. Keep in sync with
// claude/monitor/src/lib/edge/commands.ts

export type EdgeCommand =
  | { action: 'start_grid';  request_id: string }
  | { action: 'stop_grid';   request_id: string }
  // start_live: edge polls the camera's HTTP snapshot endpoint and uploads
  // each JPEG to per-camera storage. No LiveKit, no WHIP — just `camera_id`.
  | { action: 'start_live';  request_id: string; camera_id: string }
  // F77 / Phase 8.4-B — start_vod is now Storage Direct: edge fetches
  // Frigate clip.mp4 + uploads to vod-clips bucket. The cloud's POST /api/vod
  // creates the vod_clips row and forwards its id here. The legacy
  // livekit_room / livekit_whip_url fields are kept optional during the
  // rollout window so an older central server doesn't ZodError, but they
  // are NOT used by the new vod.ts. Remove after the central is on F77.
  | { action: 'start_vod';   request_id: string; camera_id: string; clip_id: string; from_iso: string; to_iso: string; livekit_room?: string; livekit_whip_url?: string }
  | { action: 'stop_stream'; request_id: string }
  | { action: 'reboot';      request_id: string }
  | { action: 'start_bcp_capture'; request_id: string; eventId: string; clips: Array<{ clipId: string; cameraId: string }>; clipFrom: string; clipTo: string; offsets?: number[] }
  // 警備: 巡回スナップショット。型契約はクラウドと一致させるが、本Phaseではエッジ側ハンドラ未実装
  // （index.ts の switch に case 無し → 受信しても無音で読み飛ばす no-op）。
  // 実装は別タスク化（ffmpeg 静止画取得 + ingest_url への POST）。
  | { action: 'capture_snapshot'; request_id: string; run_id: string; camera_ids: string[]; ingest_url: string }
  // 発報前後スナップ（PB7）: 1 発報につき全カメラ×秒オフセットの録画フレームを抽出し ingest_url へ POST。
  // ハンドラは detached 起動（数分かかるためコマンドループをブロックしない）。
  | { action: 'capture_alarm_timeline'; request_id: string; alarm_id: string; occurred_at: string; offsets_sec: number[]; ingest_url: string }

export type EdgeState = 'idle' | 'grid' | 'live' | 'vod' | 'bcp' | 'error'

export type Vendor = 'ipro' | 'uniview' | 'frigate' | 'onvif-generic' | 'i-pro-nvr'

export interface CameraDescriptor {
  id: string
  channel: number
  name: string
  grid_pos: number
  /** Frigate のみ: re-stream カメラ名 (例: "camera_01"). null の場合 channel 番号から自動生成 */
  frigate_camera: string | null
  /** go2rtc 高画質ライブ用 RTSP ソース(完全URL or パスのみ)。null=go2rtc対象外。 */
  live_rtsp: string | null
  recorder: {
    vendor: Vendor
    host: string
    rtsp_port: number
    onvif_port: number | null  // ONVIF (device/media service) の HTTP ポート。null=80
    username: string
    password: string  // plaintext at runtime; never logged
    // VOD ソース (i-PRO NVR httpdl)。null=このカメラはVOD非対応。
    vod_host: string | null
    vod_username: string | null
    vod_password: string | null   // plaintext at runtime
    vod_channel: number | null    // NVR のカメラ番号 (CAM=)
  }
}
