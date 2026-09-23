/**
 * DELETE /api/admin/licenses/[id] — ライセンスの失効（revoke）
 *
 * 物理削除ではなく status='revoked'（監査のため台帳に残す）。失効後は
 * GET /api/edge/license が 204 を返し、次回取得で nvmsd 側が権利を失う。
 * unique index（有効1件/エッジ）が空くので、同じエッジに再発行できる。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordAudit, storeIdForEdge } from '@/lib/admin/audit'

export const dynamic = 'force-dynamic'

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  // 認可: RLS で自テナントのライセンスのみ見える。見えなければ 404 相当。
  const { data: lic } = await guard.supa
    .from('licenses').select('id, edge_id').eq('id', id).maybeSingle()
  if (!lic) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { error } = await createSupabaseService()
    .from('licenses').update({ status: 'revoked', updated_at: new Date().toISOString() }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'license.revoke',
    targetType: 'edge',
    targetId: lic.edge_id,
    storeId: await storeIdForEdge(guard.supa, lic.edge_id),
    changes: { license_id: id },
  })
  return NextResponse.json({ ok: true })
}
