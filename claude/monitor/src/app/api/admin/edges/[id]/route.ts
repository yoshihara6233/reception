import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/admin/guard'
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
  // Phase B4: true にすると bootstrap が service_role を返さなくなる（per-device カナリア）。
  // 実際に省かれるのは scoped トークンを渡せた応答のみ（route 側の安全装置）。
  scoped_only:   z.boolean().optional(),
  // nvmsd OTA（NVMS/docs/OTA_SPEC.md）: 更新許可時間帯（JST・null/空=既定 02:00-05:00）と
  // 「今すぐ更新」フラグ（時間帯を無視する 1 回きり。適用確認で agent-update が自動解除）。
  update_window_start: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional().or(z.literal('')),
  update_window_end:   z.string().regex(/^\d{2}:\d{2}$/).nullable().optional().or(z.literal('')),
  update_force:        z.boolean().optional(),
})

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const parsed = PatchBody.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const patch: Record<string, unknown> = { ...parsed.data }
  if (patch.go2rtc_host === '') patch.go2rtc_host = null
  // 空文字の desired は「更新指示なし」＝NULL 化（誤って空版を配らない）。
  if (patch.desired_agent_version === '') patch.desired_agent_version = null
  if (patch.desired_cloudflared_version === '') patch.desired_cloudflared_version = null
  // 空文字の時間帯は「既定に戻す」＝NULL 化。
  if (patch.update_window_start === '') patch.update_window_start = null
  if (patch.update_window_end === '') patch.update_window_end = null

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
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const { error } = await guard.supa.from('edge_devices').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
