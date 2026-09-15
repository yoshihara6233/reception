/**
 * POST /api/edge/commands/result — HTTP 専用アップリンクのコマンド起動成否の報告
 *
 * Phase 2a（NVMS/docs/UPLINK_SPEC.md §4.3）。従来エッジの recordFinish 相当。
 * `ok` は「起動できたか」であって「撮れたか」ではない（証跡の有無は日次点検
 * evidence_gaps() の仕事、という分担は従来どおり）。
 *
 * edge_id の一致を where に含める — 他エッジの request_id を偽装して
 * 決着を上書きされないため。0 行一致でも 204 を返す（アップリンク側の
 * リトライで二重報告になっても害がないように冪等）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'

export const dynamic = 'force-dynamic'

const Body = z.object({
  request_id: z.string().uuid(),  // edge_command_runs.request_id は uuid 型
  ok: z.boolean(),
  error: z.string().max(500).nullable().optional(),
})

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { request_id, ok, error: errMsg } = parsed.data

  const { error } = await createSupabaseService()
    .from('edge_command_runs')
    .update({
      finished_at: new Date().toISOString(),
      ok,
      error: ok ? null : (errMsg ?? null),
    })
    .eq('request_id', request_id)
    .eq('edge_id', edge.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
