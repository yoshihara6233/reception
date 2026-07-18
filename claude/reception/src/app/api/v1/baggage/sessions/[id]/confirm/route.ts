/**
 * 店長の「再生して確認」記録（T6・D8）
 *
 * POST /api/v1/baggage/sessions/:id/confirm
 *   検査映像の再生確認を記録する（confirmed_by / confirmed_at）。冪等。
 *   ボタンの活性化（再生開始後のみ）は UI 側で制御する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'
import { isFullAdmin } from '@/lib/acl'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const ctx = await getAdminContext()
  if (!ctx) return NextResponse.json({ error: '認証が必要です' }, { status: 401 })

  const supabase = createAdminClient()
  const { data: s } = await supabase
    .from('inspection_sessions')
    .select('id, tenant_id, store_id, confirmed_at')
    .eq('id', id)
    .maybeSingle()

  if (!s || s.tenant_id !== ctx.tenant_id) {
    return NextResponse.json({ error: 'セッションが見つかりません' }, { status: 404 })
  }
  if (!isFullAdmin(ctx.role) && !ctx.store_ids.includes(s.store_id)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  const nowIso = new Date().toISOString()
  if (!s.confirmed_at) {
    await supabase
      .from('inspection_sessions')
      .update({ confirmed_by: ctx.id, confirmed_at: nowIso, updated_at: nowIso })
      .eq('id', id)

    await supabase.from('audit_logs').insert({
      tenant_id: s.tenant_id,
      admin_user_id: ctx.id,
      action: 'baggage.inspection.confirm',
      resource_type: 'inspection_session',
      resource_id: id,
      details: { store_id: s.store_id },
    })
  }

  return NextResponse.json({ ok: true, confirmedAt: s.confirmed_at ?? nowIso, confirmedBy: ctx.id })
}
