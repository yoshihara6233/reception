/**
 * エンロールトークンの再発行・期限延長（TC4: 本部が再発行できる導線）。
 * 未使用(pending)のトークンのみ対象。新しい生トークンを1度だけ返し、hash と
 * expires_at を更新。既にエンロール済(used_at 非NULL)なら 409。
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { recordAudit } from '@/lib/admin/audit'
import { generateEnrollToken, hashEnrollToken, enrollExpiryIso, generateShortCode, hashShortCode } from '@/lib/admin/enrollment'

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })

  const { id } = await ctx.params
  const svc = createSupabaseService()
  const { data: tok } = await svc
    .from('enrollment_tokens')
    .select('id, store_id, used_at, kind')
    .eq('id', id)
    .single()
  if (!tok) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // 認可: 店舗が見えるか（RLS セッション）。
  const { data: store } = await guard.supa
    .from('stores').select('id').eq('id', tok.store_id).single()
  if (!store) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  if (tok.used_at) return NextResponse.json({ error: 'already_enrolled' }, { status: 409 })

  const token = generateEnrollToken()
  const expires_at = enrollExpiryIso()
  // nvms は短縮コードも作り直す（QR と手入力の両方を新しくする）。
  const shortCode = tok.kind === 'nvms' ? generateShortCode() : null
  const { error } = await svc
    .from('enrollment_tokens')
    .update({
      token_hash: hashEnrollToken(token),
      short_code_hash: shortCode ? hashShortCode(shortCode) : null,
      expires_at,
    })
    .eq('id', id)
    .is('used_at', null)            // 競合で直前に使われたら更新させない
    .select('id')
    .single()
  if (error) return NextResponse.json({ error: 'already_enrolled' }, { status: 409 })

  await recordAudit(guard.supa, {
    actorUserId: guard.user.id,
    action: 'enrollment.reissue',
    targetType: 'enrollment',
    targetId: id,
    storeId: tok.store_id,
    changes: { expires_at },
  })

  return NextResponse.json({ id, token, short_code: shortCode, kind: tok.kind, expires_at })
}
