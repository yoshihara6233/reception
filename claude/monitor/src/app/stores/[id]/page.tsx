import { notFound } from 'next/navigation'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AppShell } from '@/components/AppShell'
import { MonitorWorkspace } from '@/components/MonitorWorkspace'
import type { RecorderVendor } from '@/lib/types/db'
import { pickPrimaryEdge } from '@/lib/edge/primary-edge'

interface StorePayload {
  id: string
  name: string
  area_code: string | null
  edge_devices: {
    id: string
    last_seen_at: string | null
    recorders: {
      vendor: RecorderVendor
      recorder_cameras: { id: string; channel: number; name: string; grid_pos: number; folder_path: string | null; enabled: boolean }[]
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
      edge_devices ( id, last_seen_at,
        recorders ( vendor, recorder_cameras ( id, channel, name, grid_pos, folder_path, enabled ) )
      )
    `)
    .eq('id', id)
    .single()

  if (!data) notFound()
  const store = data as never as StorePayload

  // エッジが複数ある拠点は、最後に通知が届いたエッジを代表にする (埋め込みの先頭は順不同)
  const edge    = pickPrimaryEdge(store.edge_devices)
  // Attach the owning recorder's vendor to each camera so the workspace can
  // gate the playback (VOD) button — VOD_VENDORS を見て出し分ける。
  // enabled=false (G・VMS で無効にしたカメラと、G・VMS から消えて removed_at の入ったカメラ) は表示しない
  // （消えたカメラも行は消さない — 過去のクリップ・発報・BCP が camera_id を参照しているため）。
  const cameras =
    edge?.recorders?.flatMap((r) =>
      r.recorder_cameras
        .filter((c) => c.enabled !== false)
        .map((c) => ({ ...c, vendor: r.vendor })),
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
