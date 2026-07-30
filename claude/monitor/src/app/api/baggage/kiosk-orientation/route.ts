/**
 * PUT /api/baggage/kiosk-orientation — キオスク iPad の据え付け向きを更新
 *
 * 端末の向きは「その店舗に iPad を設置した人」が一番よく知っている。店長が自店舗の
 * iPad 設定（/baggage/ipad）から自分で変えられるよう、**向きだけ**を更新する専用口を
 * 分けている。/api/baggage/settings（有効化・検査台カメラ）は運用管理者の持ち物なので
 * 混ぜない — 向きを直したいだけの操作で enabled や camera_ids を巻き添えにしないため。
 *
 * 権限は requireBaggageAccess（super_admin / 自テナントの tenant_admin / 担当店舗の
 * store_ids 保持者）。変更は admin_audit_log に記録する。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireBaggageAccess } from '@/lib/baggage/kiosk-guard'
import { recordAudit } from '@/lib/admin/audit'
import { KIOSK_ORIENTATIONS } from '@/lib/baggage/kiosk-layout'

const Body = z.object({
  storeId: z.string().uuid(),
  orientation: z.enum(KIOSK_ORIENTATIONS as unknown as [string, ...string[]]),
})

export async function PUT(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const body = parsed.data

  const guard = await requireBaggageAccess(body.storeId)
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  const { svc, store } = guard

  // 既存行の向きだけを更新する（upsert しない）。行が無い＝その店舗はまだ手荷物検査を
  // 有効化していない状態で、ここで作ると enabled=false の行が生まれて設定画面と食い違う。
  const { data, error } = await svc
    .from('inspection_settings')
    .update({ kiosk_orientation: body.orientation, updated_at: new Date().toISOString() })
    .eq('store_id', store.id)
    .select('store_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'settings_not_found' }, { status: 404 })
  }

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'baggage.kiosk_orientation.update',
    targetType: 'inspection_settings',
    targetId: store.id,
    storeId: store.id,
    changes: { orientation: body.orientation },
  })
  return NextResponse.json({ ok: true })
}
