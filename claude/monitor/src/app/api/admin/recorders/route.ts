import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { recordAudit, storeIdForEdge } from '@/lib/admin/audit'
import { encryptSecret } from '@intereco/shared'

const Body = z.object({
  edge_id:     z.string().uuid(),
  vendor:      z.enum(['ipro', 'uniview', 'frigate', 'onvif-generic', 'i-pro-nvr']),
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

  // Vault化: AES-256-GCM 封筒暗号で保存（鍵=env SECRETS_ENC_KEY。未設定時は plain: にフォールバック）。
  const { password, ...rest } = parsed.data
  const password_enc = encryptSecret(password)

  const { data, error } = await guard.supa
    .from('recorders')
    .insert({ ...rest, password_enc })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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
