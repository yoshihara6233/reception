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
  stores: { name: string; area_code: string | null }
  recorders: {
    id: string
    vendor: 'ipro' | 'uniview' | 'frigate' | 'onvif-generic'
    model: string | null
    host: string
    rtsp_port: number
    onvif_port: number | null
    username: string
    notes: string | null
    recorder_cameras: { id: string; channel: number; name: string; grid_pos: number; enabled: boolean; frigate_camera: string | null }[]
  }[]
}

export default async function EdgeEditPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supa = await createSupabaseServer()
  const { data } = await supa
    .from('edge_devices')
    .select(`
      id, name, status, agent_version, last_seen_at, store_id,
      stores ( name, area_code ),
      recorders (
        id, vendor, model, host, rtsp_port, onvif_port, username, notes,
        recorder_cameras ( id, channel, name, grid_pos, enabled, frigate_camera )
      )
    `)
    .eq('id', id)
    .single()
  if (!data) notFound()
  const edge = data as never as EdgePayload

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
