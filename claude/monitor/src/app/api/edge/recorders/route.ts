/**
 * GET /api/edge/recorders — HTTP 専用アップリンクの識別情報とカメラ対応表
 *
 * Phase 2a（NVMS/docs/UPLINK_SPEC.md §4.4）。nvmsd 内蔵アップリンクが
 * 起動時に「自分のエッジ ID・レコーダ ID（nvms-sync 用）・UUID↔NVMS カメラ ID
 * の対応表」を学ぶための唯一の読み口。
 *
 * 応答サイズは常に有界にする（NVMS は 10 万台までを謳うので全カメラは返せない）:
 *   - 既定: grid_pos 割付済み（>= 0）のカメラだけ（レコーダあたり最大 200 行で打切り）。
 *     start_grid の camera_ids 省略時の既定面はこれで引ける。
 *   - ?ids=<UUID,CSV>（≤32 件）: 指定 UUID だけを grid_pos に関係なく返す。
 *     フォルダページの camera_ids（≤16 件）に未知 UUID が来たときの解決用。
 * 対象は vendor='nvms' のレコーダのみ（内蔵アップリンクは NVMS 専用）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'

export const dynamic = 'force-dynamic'

const MAX_IDS = 32
const MAX_DEFAULT_ROWS = 200
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const idsParam = req.nextUrl.searchParams.get('ids')
  let ids: string[] | null = null
  if (idsParam !== null) {
    ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean)
    if (ids.length === 0 || ids.length > MAX_IDS || !ids.every((s) => UUID_RE.test(s))) {
      return NextResponse.json({ error: 'invalid_ids' }, { status: 400 })
    }
  }

  const svc = createSupabaseService()
  const { data: recs, error: recErr } = await svc
    .from('recorders')
    .select('id')
    .eq('edge_id', edge.id)
    .eq('vendor', 'nvms')
  if (recErr) return NextResponse.json({ error: recErr.message }, { status: 500 })

  const recorders = []
  for (const rec of recs ?? []) {
    let q = svc
      .from('recorder_cameras')
      .select('id, channel, grid_pos, folder_path, enabled')
      .eq('recorder_id', rec.id)
    q = ids
      ? q.in('id', ids)
      : q.gte('grid_pos', 0).order('grid_pos').limit(MAX_DEFAULT_ROWS)
    const { data: cams, error: camErr } = await q
    if (camErr) return NextResponse.json({ error: camErr.message }, { status: 500 })
    recorders.push({ recorder_id: rec.id, cameras: cams ?? [] })
  }

  return NextResponse.json({ edge_id: edge.id, recorders })
}
