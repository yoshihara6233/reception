/**
 * 自律OTA: カナリアで healthy を確認した版を、可視範囲の全エッジへ段階展開する。
 *
 * 安全ガード（docs/edge-ota-design.md §5）:
 *  - 「健全実績のある版のみ promote 可」。可視エッジのうち少なくとも1台が当該版を
 *    現行報告しており、かつ ota_status='healthy' でなければ 400（未検証版の一括配布を禁止）。
 *  - スコープは RLS（edges_modify）に委譲＝super_admin=全件 / tenant_admin=自テナント。
 *    desired を設定するのは可視（=書込可）エッジのみ。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { recordAudit } from '@/lib/admin/audit'

const Body = z.object({
  kind: z.enum(['agent', 'cloudflared']),
  version: z.string().min(1).max(120),
})

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { kind, version } = parsed.data

  const currentCol = kind === 'agent' ? 'agent_version' : 'cloudflared_version'
  const desiredCol = kind === 'agent' ? 'desired_agent_version' : 'desired_cloudflared_version'

  // 健全ガード: 可視エッジに「当該版を現行報告 & healthy」が1台でもあるか。
  const { data: healthy, error: hErr } = await guard.supa
    .from('edge_devices')
    .select('id')
    .eq(currentCol, version)
    .eq('ota_status', 'healthy')
    .limit(1)
  if (hErr) return NextResponse.json({ error: hErr.message }, { status: 500 })
  if (!healthy || healthy.length === 0) {
    return NextResponse.json({ error: 'no_healthy_canary' }, { status: 400 })
  }

  // 可視（書込可）エッジ一覧を取得して明示的に対象化（RLS がテナント/店舗にスコープ）。
  const { data: edges, error: lErr } = await guard.supa.from('edge_devices').select('id')
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })
  const ids = (edges ?? []).map((e) => e.id as string)
  if (ids.length === 0) return NextResponse.json({ updated: 0 })

  const { error: uErr } = await guard.supa
    .from('edge_devices')
    .update({ [desiredCol]: version })
    .in('id', ids)
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'edge.ota_promote',
    targetType: 'edge',
    targetId: 'bulk',
    storeId: null,
    changes: { kind, version, count: ids.length },
  })

  return NextResponse.json({ updated: ids.length })
}
