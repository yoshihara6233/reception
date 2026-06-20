/**
 * Fetch the local camera list for this edge from Supabase.
 * For Phase 2 the password is read in clear text from `recorders.password_enc`;
 * Vault decryption is wired up in Phase 9 once the rotation flow is in place.
 */
import { createClient } from '@supabase/supabase-js'
import { config } from './config.js'
import type { CameraDescriptor } from './types.js'

const supa = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

interface Row {
  id: string
  channel: number
  name: string
  grid_pos: number
  enabled: boolean
  frigate_camera: string | null
  live_rtsp: string | null
  recorders: {
    vendor: 'ipro' | 'uniview' | 'frigate' | 'onvif-generic' | 'i-pro-nvr'
    host: string
    rtsp_port: number
    onvif_port: number | null
    username: string
    password_enc: string
    vod_host: string | null
    vod_username: string | null
    vod_password_enc: string | null
    vod_channel: number | null
  } | null
}

/**
 * password_enc は当面平文運用。管理API(/api/admin/recorders)が `plain:` 接頭辞を
 * 付けて保存するため、ここで剥がす（Vault 化は後フェーズ）。
 */
function decodePassword(stored: string): string {
  return stored.startsWith('plain:') ? stored.slice('plain:'.length) : stored
}

export async function loadCameras(): Promise<CameraDescriptor[]> {
  const { data, error } = await supa
    .from('recorder_cameras')
    .select(`
      id, channel, name, grid_pos, enabled, frigate_camera, live_rtsp,
      recorders!inner ( vendor, host, rtsp_port, onvif_port, username, password_enc, edge_id,
                        vod_host, vod_username, vod_password_enc, vod_channel )
    `)
    .eq('enabled', true)
    .eq('recorders.edge_id', config.EDGE_ID)

  if (error) throw error
  return (data as unknown as Row[])
    .filter((r) => !!r.recorders)
    .map((r) => ({
      id: r.id,
      channel: r.channel,
      name: r.name,
      grid_pos: r.grid_pos,
      frigate_camera: r.frigate_camera,
      live_rtsp: r.live_rtsp,
      recorder: {
        vendor:       r.recorders!.vendor,
        host:         r.recorders!.host,
        rtsp_port:    r.recorders!.rtsp_port,
        onvif_port:   r.recorders!.onvif_port,
        username:     r.recorders!.username,
        password:     decodePassword(r.recorders!.password_enc),
        vod_host:     r.recorders!.vod_host,
        vod_username: r.recorders!.vod_username,
        vod_password: r.recorders!.vod_password_enc ? decodePassword(r.recorders!.vod_password_enc) : null,
        vod_channel:  r.recorders!.vod_channel,
      },
    }))
}
