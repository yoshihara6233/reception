import { notFound } from 'next/navigation'
import { AdminShell } from '@/components/AdminShell'
import { PageHeader } from '@/components/admin/PageHeader'
import { createSupabaseServer } from '@/lib/supabase/server'
import { EdgeDetail } from './edge-detail'

interface EdgePayload {
  id: string
  name: string
  status: string
  agent_version: string | null
  last_seen_at: string | null
  store_id: string
  go2rtc_host: string | null
  stores: { name: string; area_code: string | null }
  recorders: {
    id: string
    vendor: 'ipro' | 'uniview' | 'frigate' | 'onvif-generic' | 'i-pro-nvr'
    model: string | null
    host: string
    rtsp_port: number
    onvif_port: number | null
    username: string
    notes: string | null
    live_host: string | null
    vod_host: string | null
    vod_username: string | null
    vod_channel: number | null
    vod_has_password: boolean   // 値は返さない。設定済みか否かのみ
    recorder_cameras: { id: string; channel: number; name: string; grid_pos: number; enabled: boolean; frigate_camera: string | null; hls_url: string | null; live_rtsp: string | null }[]
  }[]
}

/** DB 行（vod_password_enc を含む）→ クライアント payload（has_password に畳む）。 */
interface RawRecorder {
  id: string; vendor: EdgePayload['recorders'][number]['vendor']
  model: string | null; host: string; rtsp_port: number; onvif_port: number | null
  username: string; notes: string | null
  live_host: string | null; vod_host: string | null; vod_username: string | null
  vod_channel: number | null; vod_password_enc: string | null
  recorder_cameras: EdgePayload['recorders'][number]['recorder_cameras']
}

export default async function EdgeEditPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supa = await createSupabaseServer()
  const { data } = await supa
    .from('edge_devices')
    .select(`
      id, name, status, agent_version, last_seen_at, store_id, go2rtc_host,
      stores ( name, area_code ),
      recorders (
        id, vendor, model, host, rtsp_port, onvif_port, username, notes,
        live_host, vod_host, vod_username, vod_channel, vod_password_enc,
        recorder_cameras ( id, channel, name, grid_pos, enabled, frigate_camera, hls_url, live_rtsp )
      )
    `)
    .eq('id', id)
    .single()
  if (!data) notFound()

  // vod_password_enc（秘密）はクライアントへ送らず、設定済みフラグだけにする。
  const raw = data as never as Omit<EdgePayload, 'recorders'> & { recorders: RawRecorder[] }
  const edge: EdgePayload = {
    ...raw,
    recorders: raw.recorders.map((r) => ({
      id: r.id, vendor: r.vendor, model: r.model, host: r.host, rtsp_port: r.rtsp_port,
      onvif_port: r.onvif_port, username: r.username, notes: r.notes,
      live_host: r.live_host, vod_host: r.vod_host, vod_username: r.vod_username,
      vod_channel: r.vod_channel, recorder_cameras: r.recorder_cameras,
      vod_has_password: !!r.vod_password_enc,
    })),
  }

  return (
    <AdminShell pathname="/admin/edges" section="admin">
      <PageHeader
        title={`エッジ編集: ${edge.name}`}
        crumb={[
          { href: '/admin',         label: 'マスタ' },
          { href: '/admin/edges',   label: 'エッジ' },
          { href: `/admin/edges/${id}`, label: edge.name },
        ]}
      />
      <div className="px-5 py-5">
        <EdgeDetail edge={edge} />
      </div>
    </AdminShell>
  )
}
