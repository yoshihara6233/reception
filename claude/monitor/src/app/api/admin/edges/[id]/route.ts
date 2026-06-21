import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { recordAudit, storeIdForEdge } from '@/lib/admin/audit'

const PatchBody = z.object({
  name:          z.string().min(1).max(120).optional(),
  agent_version: z.string().nullable().optional(),
  // go2rtc 公開オリジン（Cloudflare Tunnel）。このエッジ配下の onvif-generic
  // カメラが継承。従来は SQL Editor 直編集だった。空文字は NULL 化。
  go2rtc_host:   z.string().nullable().optional(),
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
