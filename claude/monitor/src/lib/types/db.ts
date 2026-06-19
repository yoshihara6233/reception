// Minimal hand-typed shape of the new tables introduced in
// 20260519_001_recorder_monitoring.sql. Regenerate from Supabase CLI later.

export type EdgeStatus = 'offline' | 'idle' | 'grid' | 'live' | 'vod' | 'error'
export type EdgeMode   = 'grid' | 'live' | 'vod'
export type RecorderVendor = 'ipro' | 'uniview' | 'frigate' | 'onvif-generic' | 'i-pro-nvr'

/**
 * Vendors whose recorders support VOD playback today.
 * - uniview : RTSP replay URL (rtsp://.../b<from>/e<to>/replay), seekable.
 * - frigate : HTTP MP4 export (clip.mp4 generated on demand). The whole range
 *   is generated before the first frame, so we cap the requested window
 *   tighter for frigate (see VOD_RANGE_MAX_MIN_BY_VENDOR).
 * - ipro    : not supported; needs ONVIF Profile-G (Phase 2 work).
 * - onvif-generic : ライブ/スナップのみ (カメラ直 ONVIF/RTSP)。VOD 非対応
 *   (2026-06-19 実機: NVR が ONVIF Profile-G を提供しない。docs/spike-ipro-nu-result.md)。
 */
export const VOD_VENDORS = ['uniview', 'frigate', 'onvif-generic', 'i-pro-nvr'] as const
export type VodVendor = (typeof VOD_VENDORS)[number]
export function isVodVendor(v: RecorderVendor): v is VodVendor {
  return (VOD_VENDORS as readonly RecorderVendor[]).includes(v)
}

/**
 * Per-vendor cap on the requested VOD window. uniview replays as a real
 * RTSP stream so 60 min is fine; frigate's clip.mp4 endpoint materializes
 * the whole range before the first frame, so 5 min keeps the first-frame
 * latency and edge memory usage acceptable.
 */
export const VOD_RANGE_MAX_MIN_BY_VENDOR: Record<VodVendor, number> = {
  uniview: 60,
  frigate: 5,
  // i-PRO NVR httpdl は 1リクエスト ≤ 1時間。実用上は短めに。
  'onvif-generic': 60,
  'i-pro-nvr': 60,
}

export interface Store {
  id: string
  tenant_id: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  area_code: string | null
  geocoded_at: string | null
  is_active: boolean
}

export interface EdgeDevice {
  id: string
  store_id: string
  name: string
  device_token: string
  agent_version: string | null
  status: EdgeStatus
  current_mode: EdgeMode | null
  last_seen_at: string | null
}

export interface Recorder {
  id: string
  edge_id: string
  vendor: RecorderVendor
  model: string | null
  host: string
  rtsp_port: number
  onvif_port: number | null
  username: string
}

export interface RecorderCamera {
  id: string
  recorder_id: string
  channel: number
  name: string
  grid_pos: number
  enabled: boolean
}

export interface LiveSession {
  id: string
  user_id: string
  store_id: string
  camera_id: string | null
  mode: EdgeMode
  livekit_room: string | null
  vod_from: string | null
  vod_to: string | null
  started_at: string
  ended_at: string | null
}
