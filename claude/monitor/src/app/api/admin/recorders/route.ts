import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'

const Body = z.object({
  edge_id:     z.string().uuid(),
  vendor:      z.enum(['ipro', 'uniview', 'frigate', 'onvif-generic']),
  model:       z.string().nullable().optional(),
  host:        z.string().min(1),
  rtsp_port:   z.coerce.number().int().min(1).max(65535).default(554),
  onvif_port:  z.coerce.number().int().min(1).max(65535).nullable().optional(),
  username:    z.string().min(0).default(''),   // Frigate は認証なしでも可
  password:    z.string().min(0).default(''),
  notes:       z.string().nullable().optional(),
})

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  // TODO Phase 9: write `password` to Supabase Vault, store ref in password_enc.
  // For now we persist plaintext to unblock Phase 5; mark with a sentinel prefix.
  const { password, ...rest } = parsed.data
  const password_enc = `plain:${password}`

  const { data, error } = await guard.supa
    .from('recorders')
    .insert({ ...rest, password_enc })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ id: data.id })
}
