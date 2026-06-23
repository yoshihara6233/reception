/**
 * エンロールトークンの状態取得（ウィザードのポーリング用）。
 * 生トークン/hash は返さない。used_at / edge_id でエンロール完了を判定できる。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const svc = createSupabaseService()
  const { data, error } = await svc
    .from('enrollment_tokens')
    .select('id, store_id, name, camera_tier, edge_id, expires_at, used_at, created_at')
    .eq('id', id)
    .single()
  if (error || !data) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // 認可: そのトークンの店舗が呼び出し管理者から見えるか（RLS セッションで確認）。
  const { data: store } = await guard.supa
    .from('stores').select('id').eq('id', data.store_id).single()
  if (!store) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  return NextResponse.json(data)
}
