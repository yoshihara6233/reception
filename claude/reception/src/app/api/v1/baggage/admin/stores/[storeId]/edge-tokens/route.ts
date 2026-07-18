/**
 * エッジ用APIトークンの発行・一覧（T2）
 *
 * POST /api/v1/baggage/admin/stores/:storeId/edge-tokens
 *   管理者が店舗にエッジ用トークンを発行する。平文はこの応答で1度だけ返す
 *   （以後は再取得不可・DB にはハッシュのみ）。
 *   body: { label?: string }
 *   res:  { id, token, label }   ← token は平文（保存表示しない）
 *
 * GET /api/v1/baggage/admin/stores/:storeId/edge-tokens
 *   店舗のトークン一覧（ハッシュは返さない）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAdminContext } from '@/lib/supabase/admin-context'
import { isFullAdmin } from '@/lib/acl'
import { generateEdgeToken, hashEdgeToken } from '@/lib/edge/token'

/** 店舗が管理者のテナントに属し、担当範囲にあることを確認する。 */
async function assertStoreAccess(storeId: string) {
  const ctx = await getAdminContext()
  if (!ctx) return { error: NextResponse.json({ error: '認証が必要です' }, { status: 401 }) }

  const supabase = createAdminClient()
  const { data: store } = await supabase
    .from('stores')
    .select('id, tenant_id')
    .eq('id', storeId)
    .maybeSingle()

  if (!store || store.tenant_id !== ctx.tenant_id) {
    // テナント越境は 404（存在秘匿）
    return { error: NextResponse.json({ error: '店舗が見つかりません' }, { status: 404 }) }
  }
  if (!isFullAdmin(ctx.role) && !ctx.store_ids.includes(storeId)) {
    return { error: NextResponse.json({ error: '権限がありません' }, { status: 403 }) }
  }
  return { ctx, store, supabase }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params
  const guard = await assertStoreAccess(storeId)
  if ('error' in guard) return guard.error
  const { ctx, store, supabase } = guard

  let label: string | undefined
  try {
    const body = await req.json().catch(() => ({}))
    label = typeof body?.label === 'string' ? body.label.slice(0, 120) : undefined
  } catch { /* body 無しは許容 */ }

  const token = generateEdgeToken()
  const tokenHash = hashEdgeToken(token)

  const { data, error } = await supabase
    .from('edge_api_tokens')
    .insert({
      tenant_id: store.tenant_id,
      store_id: storeId,
      token_hash: tokenHash,
      label: label ?? null,
    })
    .select('id, label')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'トークン発行に失敗しました' }, { status: 500 })
  }

  // 監査ログ（誰がどの店舗のトークンを発行したか）
  await supabase.from('audit_logs').insert({
    tenant_id: store.tenant_id,
    admin_user_id: ctx.id,
    action: 'baggage.edge_token.issue',
    resource_type: 'edge_api_token',
    resource_id: data.id,
    details: { store_id: storeId, label: label ?? null },
  })

  // 平文はここでだけ返す
  return NextResponse.json({ id: data.id, token, label: data.label }, { status: 201 })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ storeId: string }> },
) {
  const { storeId } = await params
  const guard = await assertStoreAccess(storeId)
  if ('error' in guard) return guard.error
  const { supabase } = guard

  const { data } = await supabase
    .from('edge_api_tokens')
    .select('id, label, last_used_at, revoked_at, created_at')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ tokens: data ?? [] })
}
