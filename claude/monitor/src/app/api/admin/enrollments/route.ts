/**
 * エッジ自己登録トークンの発行（②relay 登録ウィザード）。
 *
 * 管理者が store + name + camera_tier を指定 → 単一使用・短期TTL・tenant/store 束縛の
 * enrollment_token を発行。**生トークンは応答に1度だけ返す**（DB は hash のみ）。
 * tenant_id は store 由来（クライアント入力に依存しない＝store_id 詐称を封じる）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/admin/audit'
import { generateEnrollToken, hashEnrollToken, enrollExpiryIso } from '@/lib/admin/enrollment'

const Body = z.object({
  store_id:    z.string().uuid(),
  name:        z.string().min(1).max(120),
  camera_tier: z.coerce.number().int().refine((n) => [16, 32, 48].includes(n), 'tier must be 16/32/48').default(16),
})

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const parsed = Body.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const { store_id, name, camera_tier } = parsed.data

  // 認可: その店舗が呼び出し管理者から見えるか（RLS セッションで確認）→ tenant_id を取得。
  // 見えない店舗には発行不可（テナント越権防止）。tenant_id は store 由来。
  const { data: store } = await guard.supa
    .from('stores').select('id, tenant_id').eq('id', store_id).single()
  if (!store) return NextResponse.json({ error: 'store_not_found' }, { status: 404 })

  const token = generateEnrollToken()
  const token_hash = hashEnrollToken(token)
  const expires_at = enrollExpiryIso()

  // 挿入は service client（enrollment_tokens は RLS ポリシー無し=service のみ）。
  const svc = createSupabaseService()
  const { data, error } = await svc
    .from('enrollment_tokens')
    .insert({
      token_hash, store_id, tenant_id: store.tenant_id, name, camera_tier,
      expires_at, created_by: guard.user.id,
    })
    .select('id, expires_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'enrollment.issue',
    targetType: 'enrollment',
    targetId: data.id,
    storeId: store_id,
    changes: { name, camera_tier, expires_at: data.expires_at },
  })

  // 生トークンはここでのみ返す（再表示不可。失くしたら再発行）。
  return NextResponse.json({ id: data.id, token, expires_at: data.expires_at })
}
