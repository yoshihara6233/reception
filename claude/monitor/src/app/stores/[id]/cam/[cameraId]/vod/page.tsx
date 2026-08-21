import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AppShell } from '@/components/AppShell'
import { isVodVendor, type RecorderVendor } from '@/lib/types/db'
import VodPlayer from './vod-player'
import FrigateHlsPlayer from './frigate-hls-player'

/**
 * VOD (録画再生) route. Reached from the toolbar 録画 button (per-camera,
 * only). `from`/`to` are absolute ISO instants chosen in the range picker.
 * `incident` (optional) marks an incident instant on the scrubber when the user
 * arrived from /security.
 *
 * The player itself sends the `start_vod` command (mirrors the live route), so
 * seeking just re-issues it with a fresh publisher identity — no remount.
 */
export default async function VodPage(
  {
    params,
    searchParams,
  }: {
    params: Promise<{ id: string; cameraId: string }>
    searchParams: Promise<{ from?: string; to?: string; incident?: string }>
  },
) {
  const { id: storeId, cameraId } = await params
  const { from, to, incident }    = await searchParams
  const supa = await createSupabaseServer()

  const { data: cam } = await supa
    .from('recorder_cameras')
    .select(`
      id, name, channel, frigate_camera,
      recorders ( id, edge_id, vendor, live_host )
    `)
    .eq('id', cameraId)
    .single()

  if (!cam) notFound()
  const c = cam as never as {
    name: string
    channel: number
    frigate_camera: string | null
    recorders: { edge_id: string; vendor: RecorderVendor; live_host: string | null }
  }
  const edgeId = c.recorders.edge_id
  const vendor = c.recorders.vendor
  const room   = `vod-${cameraId}`

  // Frigate は録画をネイティブHLSで配信できる（clip.mp4 再エンコード経路より軽く、
  // 5分以上もシーク可）。frigate_camera と live_host が揃っていれば HLS 再生に分岐する。
  const frigateHls = vendor === 'frigate' && !!c.frigate_camera && !!c.recorders.live_host

  // Deep-link safety: gate unsupported vendors and missing range even though
  // the toolbar already prevents reaching here for those cases.
  const blocked =
    !isVodVendor(vendor)
      ? '録画再生はこのカメラのレコーダーでは対応していません（i-PRO は ONVIF Profile-G が必要）。'
      : (!frigateHls && (!from || !to))
        ? '再生範囲が指定されていません。'
        : null

  return (
    <AppShell selectedStoreId={storeId}>
      <main className="flex h-full flex-col overflow-hidden bg-slate-100">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 text-xs">
          <div className="text-slate-600">
            <Link href={`/stores/${storeId}`} className="text-blue-600 hover:underline">
              ← 16分割に戻る
            </Link>
            <span className="ml-3 text-slate-400">/</span>
            <span className="ml-3 font-semibold text-slate-900">
              ch{String(c.channel).padStart(2, '0')} {c.name}
            </span>
          </div>
          <div className="text-slate-500">録画再生 (VOD)</div>
        </div>
        <div className="flex-1 overflow-hidden">
          {blocked ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-400">
              {blocked}
            </div>
          ) : frigateHls ? (
            <FrigateHlsPlayer
              cameraId={cameraId}
              storeId={storeId}
              frigateCamera={c.frigate_camera!}
              fromIso={from ?? new Date().toISOString()}
              name={c.name}
              channel={c.channel}
            />
          ) : (
            <VodPlayer
              edgeId={edgeId}
              cameraId={cameraId}
              storeId={storeId}
              room={room}
              fromIso={from!}
              toIso={to!}
              channel={c.channel}
              name={c.name}
              incidentIso={incident ?? null}
            />
          )}
        </div>
      </main>
    </AppShell>
  )
}
