import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { recordAudit, storeIdForEdge } from '@/lib/admin/audit'

// 版フィールドは前後空白を除去（末尾スペース混入で git worktree add が
// "invalid reference" となり OTA が恒久 stage_failed する事故の防止）。
const trimmedNullable = z.string().nullable().optional().transform((s) => (typeof s === 'string' ? s.trim() : s))

const PatchBody = z.object({
  name:          z.string().min(1).max(120).optional(),
  agent_version: trimmedNullable,
  // go2rtc 公開オリジン（Cloudflare Tunnel）。このエッジ配下の onvif-generic
  // カメラが継承。従来は SQL Editor 直編集だった。空文字は NULL 化。
  go2rtc_host:   z.string().nullable().optional(),
  // 自律OTA: 本部が宣言する目標版（per-device＝カナリア）。空文字/NULL=更新指示なし。
  // エッジは /api/edge/bootstrap の pull で受信して self-update する。
  desired_agent_version:       trimmedNullable,
  desired_cloudflared_version: trimmedNullable,
})

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const parsed = PatchBody.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const patch: Record<string, unknown> = { ...parsed.data }
  if (patch.go2rtc_host === '') patch.go2rtc_host = null
  // 空文字の desired は「更新指示なし」＝NULL 化（誤って空版を配らない）。
  if (patch.desired_agent_version === '') patch.desired_agent_version = null
  if (patch.desired_cloudflared_version === '') patch.desired_cloudflared_version = null

  const { error } = await guard.supa.from('edge_devices').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'edge.update',
    targetType: 'edge',
    targetId: id,
    storeId: await storeIdForEdge(guard.supa, id),
    changes: parsed.data,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const { error } = await guard.supa.from('edge_devices').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
