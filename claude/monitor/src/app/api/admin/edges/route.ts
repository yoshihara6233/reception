import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { requireSuperAdmin } from '@/lib/admin/guard'
import { recordAudit } from '@/lib/admin/audit'
import { hashDeviceToken } from '@/lib/edge/device-token'

const Body = z.object({
  store_id: z.string().uuid(),
  name:     z.string().min(1).max(120),
})

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const device_token = randomBytes(32).toString('hex')

  const { data, error } = await guard.supa
    .from('edge_devices')
    .insert({
      store_id:     parsed.data.store_id,
      name:         parsed.data.name,
      // 段階1: 平文列は残っている（NOT NULL）ので両方書く。段階2で平文を落とす。
      device_token,
      device_token_hash: hashDeviceToken(device_token),
      status:       'offline',
    })
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // 監査: device_token は記録しない。
  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action:      'edge.create',
    targetType:  'edge',
    targetId:    data.id,
    storeId:     parsed.data.store_id,
    changes:     { name: parsed.data.name },
  })

  // Return the token ONCE — we won't surface it again.
  return NextResponse.json({ id: data.id, device_token })
}
