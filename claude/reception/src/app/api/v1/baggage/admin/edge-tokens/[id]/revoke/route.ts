/**
 * エッジ用APIトークンの失効（T2）
 *
 * POST /api/v1/baggage/admin/edge-tokens/:id/revoke
 *   管理者がトークンを失効させる（revoked_at を設定）。冪等。
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
  const { data: tok } = await supabase
    .from('edge_api_tokens')
    .select('id, tenant_id, store_id, revoked_at')
    .eq('id', id)
    .maybeSingle()

  if (!tok || tok.tenant_id !== ctx.tenant_id) {
    return NextResponse.json({ error: 'トークンが見つかりません' }, { status: 404 })
  }
  if (!isFullAdmin(ctx.role) && !ctx.store_ids.includes(tok.store_id)) {
    return NextResponse.json({ error: '権限がありません' }, { status: 403 })
  }

  if (!tok.revoked_at) {
    await supabase
      .from('edge_api_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)

    await supabase.from('audit_logs').insert({
      tenant_id: tok.tenant_id,
      admin_user_id: ctx.id,
      action: 'baggage.edge_token.revoke',
      resource_type: 'edge_api_token',
      resource_id: id,
      details: { store_id: tok.store_id },
    })
  }

  return NextResponse.json({ ok: true, revoked: true })
}
