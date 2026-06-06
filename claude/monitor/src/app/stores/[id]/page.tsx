import { notFound } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AppShell } from '@/components/AppShell'
import { MonitorWorkspace } from '@/components/MonitorWorkspace'
import type { RecorderVendor } from '@/lib/types/db'

interface StorePayload {
  id: string
  name: string
  area_code: string | null
  edge_devices: {
    id: string
    recorders: {
      vendor: RecorderVendor
      recorder_cameras: { id: string; channel: number; name: string; grid_pos: number }[]
    }[]
  }[]
}

export default async function StorePage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supa = await createSupabaseServer()

  const { data } = await supa
    .from('stores')
    .select(`
      id, name, area_code,
      edge_devices ( id,
        recorders ( vendor, recorder_cameras ( id, channel, name, grid_pos ) )
      )
    `)
    .eq('id', id)
    .single()

  if (!data) notFound()
  const store = data as never as StorePayload

  const edge    = store.edge_devices?.[0]
  // Attach the owning recorder's vendor to each camera so the workspace can
  // gate the playback (VOD) button — Phase 1 supports uniview only.
  const cameras =
    edge?.recorders?.flatMap((r) =>
      r.recorder_cameras.map((c) => ({ ...c, vendor: r.vendor })),
    ) ?? []

  // F47: NVR 設定はモニタリングユーザに見せず、/admin/stores/[id]/nvr に分離した。
  // ここはライブ監視一本に戻す (タブナビなし)。
  return (
    <AppShell selectedStoreId={id}>
      <MonitorWorkspace
        key={id}
        storeId={id}
        storeName={store.name}
        area={store.area_code}
        edgeId={edge?.id ?? null}
        cameras={cameras}
      />
    </AppShell>
  )
}
