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
  recorders: {
    vendor: 'ipro' | 'uniview' | 'frigate'
    host: string
    rtsp_port: number
    username: string
    password_enc: string
  } | null
}

export async function loadCameras(): Promise<CameraDescriptor[]> {
  const { data, error } = await supa
    .from('recorder_cameras')
    .select(`
      id, channel, name, grid_pos, enabled, frigate_camera,
      recorders!inner ( vendor, host, rtsp_port, username, password_enc, edge_id )
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
      recorder: {
        vendor:    r.recorders!.vendor,
        host:      r.recorders!.host,
        rtsp_port: r.recorders!.rtsp_port,
        username:  r.recorders!.username,
        password:  r.recorders!.password_enc,
      },
    }))
}
