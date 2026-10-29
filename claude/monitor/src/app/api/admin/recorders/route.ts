import { NextRequest, NextResponse } from 'next/server'
import { invalidInput } from '@/lib/api/invalid-input'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { recordAudit, storeIdForEdge } from '@/lib/admin/audit'
import { encryptSecretForEdge } from '@intereco/shared'
import { dbErrorCode } from '@/lib/api/db-error'

const Body = z.object({
  edge_id:     z.string().uuid(),
  vendor:      z.enum(['ipro', 'frigate', 'onvif-generic', 'i-pro-nvr', 'nvms']),
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
  if (!parsed.success) return invalidInput(req, { error: 'invalid_body' }, guard.user.id)

  // Vault化: そのエッジの鍵で暗号化 (enc:v2・エッジごとの鍵・packages/shared/src/secret-codec.ts)。
  const { password, ...rest } = parsed.data
  const password_enc = encryptSecretForEdge(password, rest.edge_id)

  const { data, error } = await guard.supa
    .from('recorders')
    .insert({ ...rest, password_enc })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: dbErrorCode(error, '/api/admin/recorders') }, { status: 500 })

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'recorder.create',
    targetType: 'recorder',
    targetId: data.id,
    storeId: await storeIdForEdge(guard.supa, rest.edge_id),
    changes: { vendor: rest.vendor, model: rest.model ?? null, host: rest.host, rtsp_port: rest.rtsp_port },
  })
  return NextResponse.json({ id: data.id })
}
