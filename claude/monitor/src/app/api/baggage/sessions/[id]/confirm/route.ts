/**
 * POST /api/baggage/sessions/[id]/confirm — 店長の再生確認（M4・D8）
 *
 * confirmed_by（admin_users.id）/ confirmed_at を記録する。
 * 可視性は RLS 越し read で担保し、書き込みは service role（ポリシー無し=deny のため）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  // RLS 越し: 見えるセッションのみ（store スコープ担保）
  const { data: sess } = await guard.supa
    .from('inspection_sessions')
    .select('id, status')
    .eq('id', id)
    .maybeSingle()
  if (!sess) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (sess.status === 'entered') {
    return NextResponse.json({ error: 'not_finished' }, { status: 409 })
  }

  const svc = createSupabaseService()
  const { error } = await svc
    .from('inspection_sessions')
    .update({ confirmed_by: guard.profile.id, confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
