import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'

const PatchBody = z.object({
  model:      z.string().nullable().optional(),
  host:       z.string().optional(),
  rtsp_port:  z.coerce.number().int().min(1).max(65535).optional(),
  onvif_port: z.coerce.number().int().min(1).max(65535).nullable().optional(),
  username:   z.string().optional(),
  password:   z.string().optional(),
  notes:      z.string().nullable().optional(),
  // ライブ/VOD/go2rtc 系（従来は SQL Editor 直編集だったフィールドを UI 化）。
  live_host:    z.string().nullable().optional(),   // Frigate iframe 用 LAN host:port
  vod_host:     z.string().nullable().optional(),   // VOD元 NVR の HTTPS endpoint
  vod_username: z.string().nullable().optional(),
  vod_password: z.string().optional(),              // 空欄=現状維持。非空のみ更新
  vod_channel:  z.coerce.number().int().min(1).max(64).nullable().optional(),
})

/** 空文字は NULL に正規化（UI でクリア＝NULL にできるように）。 */
const NULLABLE_TEXT = ['model', 'notes', 'live_host', 'vod_host', 'vod_username'] as const

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
  for (const k of NULLABLE_TEXT) {
    if (patch[k] === '') patch[k] = null
  }
  if (patch.password) {
    patch.password_enc = `plain:${patch.password}`     // TODO Phase 9: Vault
  }
  delete patch.password
  // VOD パスワードは空欄=現状維持。非空のときだけ plain: sentinel で更新。
  if (typeof patch.vod_password === 'string' && patch.vod_password !== '') {
    patch.vod_password_enc = `plain:${patch.vod_password}`
  }
  delete patch.vod_password

  const { error } = await guard.supa.from('recorders').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const { error } = await guard.supa.from('recorders').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
