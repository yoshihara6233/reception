import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'

const Body = z.object({
  name:       z.string().min(1).optional(),
  address:    z.string().nullable().optional(),
  area_code:  z.string().nullable().optional(),
  latitude:   z.number().min(-90).max(90).nullable().optional(),
  longitude:  z.number().min(-180).max(180).nullable().optional(),
  timezone:   z.string().nullable().optional(),
  is_active:  z.boolean().optional(),
})

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.format() }, { status: 400 })

  const patch: Record<string, unknown> = { ...parsed.data }
  if (patch.latitude != null && patch.longitude != null) patch.geocoded_at = new Date().toISOString()

  const { error } = await guard.supa.from('stores').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
