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
  if (patch.password) {
    patch.password_enc = `plain:${patch.password}`     // TODO Phase 9: Vault
    delete patch.password
  }

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
