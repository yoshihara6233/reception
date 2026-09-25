/**
 * POST /api/edge/video/status — 遠隔視聴の起動後の変化の報告（GVMS_CLOUD_SPEC §5.5）
 *
 *   { session_id, state: 'ended' | 'stopped' | 'error', error, at } → 204
 *
 * `ended` は録画再生の終わり、`stopped` は合図切れか stop_video、`error` は途中の失敗。
 * 画面はこの状態を見て、静止画ライブへ戻す・エラーを出すを決める。
 *
 * edge_id の一致を where に含める（他拠点のセッションを閉じさせない）。
 * すでに終わっているセッションは書き換えない — クラウドが stop_video を渡して先に
 * stopped にした後で、拠点の stopped が届くのが普通の順番。0 行一致でも 204（冪等）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseService } from '@/lib/supabase/server'
import { authenticateEdge } from '@/lib/edge/device-auth'
import { ACTIVE_STATES, normalizeVideoError } from '@/lib/video/session-logic'

export const dynamic = 'force-dynamic'

const Body = z.object({
  session_id: z.string().uuid(),
  state: z.enum(['ended', 'stopped', 'error']),
  error: z.string().max(64).nullable().optional(),
  at: z.string().max(64).optional(),
})

export async function POST(req: NextRequest) {
  const edge = await authenticateEdge(req)
  if (!edge) return NextResponse.json({ error: 'invalid device token' }, { status: 401 })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { session_id, state, error } = parsed.data

  const { error: dbErr } = await createSupabaseService()
    .from('video_sessions')
    .update({
      state,
      error: state === 'error' ? normalizeVideoError(error) : null,
      ended_at: new Date().toISOString(),
    })
    .eq('id', session_id)
    .eq('edge_id', edge.id)
    .in('state', ACTIVE_STATES as string[])
  if (dbErr) return NextResponse.json({ error: 'update_failed' }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
