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
import { applyStartResult } from '@/lib/video/dispatch'
import { normalizeVideoError } from '@/lib/video/session-logic'

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

  const svc = createSupabaseService()
  const { error } = await svc
    .from('edge_command_runs')
    .update({
      finished_at: new Date().toISOString(),
      ok,
      error: ok ? null : (errMsg ?? null),
    })
    .eq('request_id', request_id)
    .eq('edge_id', edge.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 診断バンドル（DIAGNOSTICS_SPEC §2.3）は result の ok=true をもって「到着」と
  // 扱う — 完了通知の専用エンドポイントを作らない取り決め。診断以外の
  // request_id は先置き行が無いので 0 行一致で素通り（冪等）。
  await svc
    .from('diagnostic_bundles')
    .update({
      status: ok ? 'completed' : 'failed',
      error: ok ? null : (errMsg ?? null),
      uploaded_at: ok ? new Date().toISOString() : null,
    })
    .eq('request_id', request_id)
    .eq('edge_id', edge.id)
    .eq('status', 'pending')

  // 遠隔視聴の開始（GVMS_CLOUD_SPEC §5.1）。ok は「起動できたか」で、映像が届いたかは
  // 別（プレイリストの到着で見る）。失敗の値は §5.1 の語彙に丸めて画面の戻り先を決める。
  // 開始の指示でなければ 0 行一致で素通り。
  await applyStartResult(svc, edge.id, request_id, ok, ok ? null : normalizeVideoError(errMsg))

  return new NextResponse(null, { status: 204 })
}
