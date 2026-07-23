/**
 * POST /api/admin/acting-tenant — super_admin の「操作中テナント」を設定
 * DELETE — 解除
 *
 * 操作中テナントは httpOnly cookie に保持し、①設定プレーン（店舗/ユーザ/検査設定 等）の
 * 全ページ・作成フォームをこのテナントに固定する。フォーム側にテナント drop-down を
 * 置かないための土台（選び間違いで他テナントへ書き込む事故を構造的に防ぐ）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdmin } from '@/lib/admin/guard'
import { createSupabaseService } from '@/lib/supabase/server'
import { ACTING_TENANT_COOKIE } from '@/lib/tenant/acting'

const Body = z.object({ tenant_id: z.string().uuid() })

export async function POST(req: NextRequest) {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  if (guard.profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin_only' }, { status: 403 })
  }

  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  // 実在テナントのみ許可（削除済み・偽IDを cookie に入れさせない）。
  const svc = createSupabaseService()
  const { data: tn } = await svc.from('tenants').select('id, name').eq('id', parsed.data.tenant_id).maybeSingle()
  if (!tn) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 })

  const res = NextResponse.json({ ok: true, id: tn.id, name: tn.name })
  res.cookies.set(ACTING_TENANT_COOKIE, tn.id, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 8, // 8時間で自然失効
    secure: process.env.NODE_ENV === 'production',
  })
  return res
}

export async function DELETE() {
  const guard = await requireAdmin()
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status })
  // 解除は super_admin 以外でも害はないが、対称性のため同じガードにする。
  if (guard.profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'super_admin_only' }, { status: 403 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(ACTING_TENANT_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
