/**
 * POST /api/edge/bcp-grid-upload-url — BCP 合成ショットの署名アップロード URL
 *
 * Phase 2b（NVMS/docs/UPLINK_CLIPS_SPEC.md §5.1）。計画行（bcp_grid_shots）は
 * 発令側 jalert-poller が pending で先置きする — **この受け口は行を作らない**。
 * 無い組は 404: 計画に無いページをエッジ側の裁量で増やせない形にする
 * （期待枚数 = 先置き行数、がイベント完了判定の根拠なので崩さない）。
 *
 * 同じ要求は同じ storage_path・同じ行を返す（リトライ冪等）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { gridShotStoragePath } from '@/lib/edge/bcp-uplink'

export const dynamic = 'force-dynamic'

const Body = z.object({
  event_id:   z.string().uuid(),
  page_no:    z.number().int().min(1).max(4096),
  offset_min: z.number().int().min(-60).max(1440),
})

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { event_id, page_no, offset_min } = parsed.data

  const svc = createSupabaseService()
  const { data: shot } = await svc
    .from('bcp_grid_shots')
    .select('id, recorder_id, storage_path')
    .eq('event_id', event_id).eq('page_no', page_no).eq('offset_min', offset_min)
    .maybeSingle()
  if (!shot) return NextResponse.json({ error: 'unknown_shot' }, { status: 404 })

  // 所有検査: ショットのレコーダがこのエッジのものか + イベントがこの店舗か。
  const { data: rec } = await svc
    .from('recorders').select('edge_id').eq('id', shot.recorder_id).maybeSingle()
  if (!rec || rec.edge_id !== edge.id) {
    return NextResponse.json({ error: 'not owned by this edge' }, { status: 403 })
  }
  const { data: ev } = await svc
    .from('bcp_events').select('store_id, alert_issued_at').eq('id', event_id).maybeSingle()
  if (!ev || ev.store_id !== edge.store_id) {
    return NextResponse.json({ error: 'event not in this store' }, { status: 403 })
  }

  let path = shot.storage_path as string | null
  if (!path) {
    const targetAt = new Date(new Date(ev.alert_issued_at).getTime() + offset_min * 60_000)
    path = gridShotStoragePath(event_id, page_no, offset_min, targetAt)
    await svc.from('bcp_grid_shots').update({ storage_path: path }).eq('id', shot.id)
  }

  const { data: signed, error } = await svc.storage
    .from('bcp-clips')
    .createSignedUploadUrl(path, { upsert: true })
  if (error || !signed) {
    return NextResponse.json({ error: error?.message ?? 'sign failed' }, { status: 500 })
  }

  return NextResponse.json({ url: signed.signedUrl, shot_id: shot.id })
}
