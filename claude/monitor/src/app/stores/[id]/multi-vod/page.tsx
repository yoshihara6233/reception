import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServer } from '@/lib/supabase/server'
import { AppShell } from '@/components/AppShell'
import type { RecorderVendor } from '@/lib/types/db'
import MultiVodPlayer, { type MultiVodCam } from './multi-vod-player'

/**
 * C-2-4 複数カメラ同期再生（最大4ch・時刻同期スクラバ）。
 *
 * 対象は Frigate 録画のみ（/api/vod-hls の UTC時HLS を N面同時シーク）。i-PRO NVR は
 * httpdl.cgi クリップで同期が難しいため当面対象外。ALARM/BCP 詳細の「同期再生」導線、
 * および本ページ内のカメラピッカー（汎用）から到達する。
 *
 * Query: cams=<cameraId,cameraId,… 最大4>・from=<ISO>・incident=<ISO 任意>
 */
export const MAX_SYNC_CAMS = 4

export default async function MultiVodPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ cams?: string; from?: string; incident?: string }>
}) {
  const { id: storeId } = await params
  const { cams, from, incident } = await searchParams
  const supa = await createSupabaseServer()

  // 店舗→エッジ→レコーダ→カメラ（RLSスコープ）。Frigate かつ frigate_camera 設定済のみ候補。
  const { data: store } = await supa
    .from('stores')
    .select(`
      id, name,
      edge_devices ( recorders ( vendor, recorder_cameras ( id, channel, name, frigate_camera ) ) )
    `)
    .eq('id', storeId)
    .single()
  if (!store) notFound()

  const s = store as unknown as {
    name: string
    edge_devices: { recorders: { vendor: RecorderVendor; recorder_cameras: { id: string; channel: number; name: string; frigate_camera: string | null }[] }[] }[]
  }
  const candidates: MultiVodCam[] = (s.edge_devices?.[0]?.recorders ?? [])
    .filter((r) => r.vendor === 'frigate')
    .flatMap((r) => r.recorder_cameras)
    .filter((c) => !!c.frigate_camera)
    .map((c) => ({ cameraId: c.id, frigateCamera: c.frigate_camera as string, name: c.name, channel: c.channel }))
    .sort((a, b) => a.channel - b.channel)

  const requested = (cams ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const selected = candidates
    .filter((c) => requested.includes(c.cameraId))
    .slice(0, MAX_SYNC_CAMS)

  return (
    <AppShell selectedStoreId={storeId}>
      <main className="flex h-full flex-col overflow-hidden bg-slate-100">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2 text-xs">
          <div className="text-slate-600">
            <Link href={`/stores/${storeId}`} className="text-blue-600 hover:underline">← 16分割に戻る</Link>
            <span className="ml-3 font-semibold text-slate-900">{s.name}</span>
          </div>
          <div className="text-slate-500">複数カメラ同期再生（最大{MAX_SYNC_CAMS}ch）</div>
        </div>
        <div className="flex-1 overflow-hidden">
          {candidates.length === 0 ? (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-400">
              同期再生に対応する Frigate 録画カメラがこの店舗にありません。
            </div>
          ) : (
            <MultiVodPlayer
              storeId={storeId}
              candidates={candidates}
              selected={selected}
              fromIso={from ?? new Date().toISOString()}
              incidentIso={incident ?? null}
            />
          )}
        </div>
      </main>
    </AppShell>
  )
}
