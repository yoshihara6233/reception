/**
 * POST /api/edge/nvms-health — NVMS の死活サマリを受け取る（M3・報告型）
 *
 * 10万台をクラウドから個別ポーリングしない。NVMS が自分のカメラを監視して
 * いる（切断検知・録画抜け・容量予測）ので、クラウドはその**集計と異常差分
 * だけ**を 5 分ごとに受ける。クラウド側の監視対象は「この報告が新鮮か」
 * （health_at が止まったらエッジか NVMS が沈黙）と「報告の中の異常件数」。
 *
 * サマリの形は recorders.health(jsonb) に緩く保存し、必須キーだけ zod で見る。
 * NVMS 側が項目を増やしてもここを壊さないため。down リストは 50 件で打ち切り
 * （画面は「多すぎる異常」を件数で見せれば足り、行を全部運ぶ必要は無い）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'

export const dynamic = 'force-dynamic'

const Body = z.object({
  recorderId: z.string().uuid(),
  health: z.object({
    cameras_total:   z.number().int().min(0),
    cameras_online:  z.number().int().min(0),
    cameras_offline: z.number().int().min(0),
    down: z.array(z.object({
      id:          z.number().int(),
      name:        z.string().max(200),
      folder_path: z.string().max(500).nullable().optional(),
    })).max(50),
    gaps_24h:        z.number().int().min(0).optional(),
    disk_days_left:  z.number().nullable().optional(),
    nodes_total:     z.number().int().optional(),
    nodes_ok:        z.number().int().optional(),
    nvms_version:    z.string().max(50).optional(),
  }).passthrough(),
})

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { recorderId, health } = parsed.data

  const svc = createSupabaseService()
  const { data: rec } = await svc
    .from('recorders')
    .select('id, vendor, edge_id')
    .eq('id', recorderId)
    .maybeSingle()
  if (!rec || rec.edge_id !== edge.id) {
    return NextResponse.json({ error: 'recorder not owned by this edge' }, { status: 403 })
  }

  const { error } = await svc
    .from('recorders')
    .update({ health, health_at: new Date().toISOString() })
    .eq('id', recorderId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
