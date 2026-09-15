/**
 * POST /api/edge/heartbeat — HTTP 専用アップリンク（nvmsd 内蔵）の生存報告
 *
 * Phase 2a（NVMS/docs/UPLINK_SPEC.md §4.1）。従来のエッジ端末は Supabase の
 * スコープトークンで edge_devices を直接 update するが、nvmsd 内蔵アップリンクは
 * Supabase を一切持たない設計（OEM 配布物に SaaS の SDK・鍵・スキーマ知識を
 * 埋めない）。その代わりにこの薄い受け口が同じ更新を代行する。
 *
 * agent_version の `nvmsd/` プレフィックスが「内蔵アップリンク」の印
 * （bootstrap・OTA 前提の点検から見分けるため。UPLINK_SPEC §4.1 で必須）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'

export const dynamic = 'force-dynamic'

const Body = z.object({
  status: z.enum(['idle', 'grid', 'live', 'vod', 'bcp', 'error', 'offline']),
  agent_version: z.string().max(100).optional(),
})

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { status, agent_version } = parsed.data

  const payload: Record<string, unknown> = {
    status,
    last_seen_at: new Date().toISOString(),
  }
  if (agent_version) payload.agent_version = agent_version

  const { error } = await createSupabaseService()
    .from('edge_devices')
    .update(payload)
    .eq('id', edge.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
